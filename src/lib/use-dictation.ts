"use client";

import * as React from "react";

export interface TranscriptPayload {
  final: string;
  interim: string;
  raw: string;
}

export interface UseDictationOptions {
  onTranscript?: (payload: TranscriptPayload) => void;
  onTurnEnd?: () => void;
  onError?: (error: "not_supported" | "not_allowed" | "no_microphone" | "network_error" | "not_secure" | string) => void;
  lang?: string;
}

export function useDictation({ onTranscript, onTurnEnd, onError, lang }: UseDictationOptions = {}) {
  const [isListening, setIsListening] = React.useState(false);
  const [isSupported, setIsSupported] = React.useState(false);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const recognitionRef = React.useRef<any>(null);
  const shouldListenRef = React.useRef(false);

  React.useEffect(() => {
    if (typeof window !== "undefined") {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      const isSecure = window.isSecureContext || window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";
      setIsSupported(Boolean(SpeechRecognition && isSecure));
    }
  }, []);

  const stop = React.useCallback(() => {
    shouldListenRef.current = false;
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {
        // Ignore stop errors on already stopped instances
      }
      recognitionRef.current = null;
    }
    setIsListening(false);
  }, []);

  const start = React.useCallback(async () => {
    if (typeof window === "undefined") return;

    // Check secure context
    if (!window.isSecureContext && window.location.hostname !== "localhost" && window.location.hostname !== "127.0.0.1") {
      onError?.("not_secure");
      return;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      onError?.("not_supported");
      return;
    }

    // Stop any existing session cleanly
    if (recognitionRef.current) {
      try {
        recognitionRef.current.abort();
      } catch {}
      recognitionRef.current = null;
    }

    // Explicitly request microphone access via getUserMedia.
    // This immediately triggers the browser's native permission pop-up dialog
    // on Chrome, Safari, and Edge instead of silently failing with 'not-allowed'.
    if (navigator?.mediaDevices?.getUserMedia) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        // Immediately stop all audio tracks so SpeechRecognition has exclusive mic control
        stream.getTracks().forEach((track) => track.stop());
      } catch (err: unknown) {
        const errName = (err as { name?: string })?.name;
        if (errName === "NotAllowedError" || errName === "PermissionDeniedError") {
          onError?.("not_allowed");
        } else if (errName === "NotFoundError" || errName === "DevicesNotFoundError") {
          onError?.("no_microphone");
        } else {
          onError?.("not_allowed");
        }
        setIsListening(false);
        shouldListenRef.current = false;
        return;
      }
    }

    try {
      const recognition = new SpeechRecognition();
      try {
        recognition.continuous = true;
      } catch {
        // Some Safari versions don't support continuous=true
      }
      recognition.interimResults = true;
      recognition.maxAlternatives = 1;

      if (lang) {
        recognition.lang = lang;
      } else if (typeof navigator !== "undefined" && navigator.language) {
        recognition.lang = navigator.language;
      }

      recognition.onstart = () => {
        setIsListening(true);
        shouldListenRef.current = true;
      };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      recognition.onresult = (event: any) => {
        let sessionFinal = "";
        let sessionInterim = "";

        for (let i = 0; i < event.results.length; ++i) {
          const item = event.results[i];
          const text = item[0]?.transcript || "";
          if (item.isFinal) {
            sessionFinal += text;
          } else {
            sessionInterim += text;
          }
        }

        onTranscript?.({
          final: sessionFinal,
          interim: sessionInterim,
          raw: sessionFinal + sessionInterim,
        });
      };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      recognition.onerror = (event: any) => {
        const error = event.error;
        if (error === "no-speech" || error === "aborted") {
          return;
        }

        if (error === "not-allowed" || error === "service-not-allowed") {
          onError?.("not_allowed");
        } else if (error === "audio-capture") {
          onError?.("no_microphone");
        } else if (error === "network") {
          onError?.("network_error");
        } else {
          onError?.(error || "unknown");
        }
        shouldListenRef.current = false;
        setIsListening(false);
      };

      recognition.onend = () => {
        if (shouldListenRef.current) {
          try {
            onTurnEnd?.();
            recognition.start();
            return;
          } catch {
            // Settle if restart fails
          }
        }
        setIsListening(false);
        shouldListenRef.current = false;
        recognitionRef.current = null;
      };

      recognitionRef.current = recognition;
      recognition.start();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      onError?.(msg);
      setIsListening(false);
      shouldListenRef.current = false;
    }
  }, [lang, onError, onTranscript, onTurnEnd]);

  const toggle = React.useCallback(() => {
    if (isListening || shouldListenRef.current) {
      stop();
    } else {
      void start();
    }
  }, [isListening, start, stop]);

  React.useEffect(() => {
    return () => {
      shouldListenRef.current = false;
      if (recognitionRef.current) {
        try {
          recognitionRef.current.abort();
        } catch {}
        recognitionRef.current = null;
      }
    };
  }, []);

  return {
    isListening,
    isSupported,
    start,
    stop,
    toggle,
  };
}
