/**
 * Moteur de dictée vocale "1 appui = 1 article" optimisé pour Android Chrome (fr-FR).
 * Inclut un retour sonore discret (Web Audio API) et des vibrations haptiques Android.
 */

(function (global) {
  'use strict';

  const SpeechRecognitionAPI =
    global.SpeechRecognition || global.webkitSpeechRecognition || null;

  let audioCtx = null;

  function playTone(type, enabled) {
    if (!enabled) return;
    try {
      const AudioContextClass = global.AudioContext || global.webkitAudioContext;
      if (!AudioContextClass) return;
      if (!audioCtx) audioCtx = new AudioContextClass();
      if (audioCtx.state === 'suspended') audioCtx.resume();

      const now = audioCtx.currentTime;
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.connect(gain);
      gain.connect(audioCtx.destination);

      if (type === 'start') {
        osc.type = 'sine';
        osc.frequency.setValueAtTime(520, now);
        osc.frequency.exponentialRampToValueAtTime(680, now + 0.09);
        gain.gain.setValueAtTime(0.08, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
        osc.start(now);
        osc.stop(now + 0.13);
      } else if (type === 'success') {
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(660, now);
        osc.frequency.setValueAtTime(880, now + 0.07);
        gain.gain.setValueAtTime(0.08, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
        osc.start(now);
        osc.stop(now + 0.19);
      } else if (type === 'cancel') {
        osc.type = 'sine';
        osc.frequency.setValueAtTime(420, now);
        osc.frequency.exponentialRampToValueAtTime(300, now + 0.1);
        gain.gain.setValueAtTime(0.06, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
        osc.start(now);
        osc.stop(now + 0.13);
      }
    } catch (_) {}
  }

  function vibrate(pattern, enabled) {
    if (!enabled) return;
    try {
      if (navigator.vibrate) navigator.vibrate(pattern);
    } catch (_) {}
  }

  class VoiceDictation {
    constructor(callbacks) {
      this.callbacks = callbacks || {};
      this.recognition = null;
      this.isListening = false;
      this.hasDelivered = false;
      this.latestTranscript = '';
      this.cancelled = false;
    }

    static isSupported() {
      return Boolean(SpeechRecognitionAPI);
    }

    start(feedbackEnabled, lang) {
      if (!SpeechRecognitionAPI) {
        if (this.callbacks.onError) {
          this.callbacks.onError(
            'La reconnaissance vocale nécessite Chrome sur Android (en HTTPS).'
          );
        }
        return false;
      }

      if (this.isListening) {
        this.cancel(feedbackEnabled);
        return false;
      }

      this.hasDelivered = false;
      this.latestTranscript = '';
      this.cancelled = false;

      const rec = new SpeechRecognitionAPI();
      rec.lang = lang || 'fr-BE';
      rec.continuous = false; // 1 appui = 1 élément, arrêt automatique après l'article
      rec.interimResults = true;
      rec.maxAlternatives = 1;

      rec.onstart = () => {
        this.isListening = true;
        playTone('start', feedbackEnabled);
        vibrate(25, feedbackEnabled);
        if (this.callbacks.onStart) this.callbacks.onStart();
      };

      rec.onresult = (event) => {
        if (this.cancelled) return;
        let interim = '';
        let finalText = '';

        for (let i = event.resultIndex; i < event.results.length; i++) {
          const chunk = event.results[i][0].transcript;
          if (event.results[i].isFinal) {
            finalText += chunk;
          } else {
            interim += chunk;
          }
        }

        const display = (finalText || interim).trim();
        if (display) {
          this.latestTranscript = display;
          if (this.callbacks.onInterim) this.callbacks.onInterim(display);
        }

        if (finalText.trim() && !this.hasDelivered) {
          this.hasDelivered = true;
          playTone('success', feedbackEnabled);
          vibrate([20, 40, 20], feedbackEnabled);
          if (this.callbacks.onFinal) this.callbacks.onFinal(finalText.trim());
          try {
            rec.stop();
          } catch (_) {}
        }
      };

      rec.onerror = (event) => {
        if (this.cancelled) return;
        let msg = '';
        switch (event.error) {
          case 'no-speech':
            msg = 'Aucun son détecté — appuyez sur le micro et parlez clairement.';
            break;
          case 'audio-capture':
            msg = 'Aucun microphone disponible sur cet appareil.';
            break;
          case 'not-allowed':
          case 'service-not-allowed':
            msg =
              "Accès au micro refusé. Autorisez le microphone dans les paramètres de Chrome (HTTPS requis).";
            break;
          case 'network':
            msg = 'Connexion réseau nécessaire pour la reconnaissance vocale.';
            break;
          case 'aborted':
            msg = '';
            break;
          default:
            msg = 'Erreur micro : ' + event.error;
        }
        if (msg && this.callbacks.onError) {
          this.callbacks.onError(msg);
        }
      };

      rec.onend = () => {
        const wasListening = this.isListening;
        this.isListening = false;
        this.recognition = null;

        // Filet de sécurité Android : certains téléphones coupent avant de marquer isFinal
        if (wasListening && !this.cancelled && !this.hasDelivered && this.latestTranscript) {
          this.hasDelivered = true;
          playTone('success', feedbackEnabled);
          vibrate([20, 40, 20], feedbackEnabled);
          if (this.callbacks.onFinal) this.callbacks.onFinal(this.latestTranscript);
        }

        if (this.callbacks.onEnd) this.callbacks.onEnd();
      };

      this.recognition = rec;
      try {
        rec.start();
        return true;
      } catch (err) {
        this.isListening = false;
        this.recognition = null;
        if (this.callbacks.onError) {
          this.callbacks.onError('Impossible de démarrer le micro : ' + err.message);
        }
        return false;
      }
    }

    cancel(feedbackEnabled) {
      this.cancelled = true;
      this.isListening = false;
      playTone('cancel', feedbackEnabled);
      vibrate(15, feedbackEnabled);
      if (this.recognition) {
        try {
          this.recognition.abort();
        } catch (_) {}
        this.recognition = null;
      }
      if (this.callbacks.onEnd) this.callbacks.onEnd();
    }
  }

  global.CoursesSpeech = {
    VoiceDictation,
    playTone,
    vibrate,
  };
})(window);
