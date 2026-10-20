import { useEffect, useRef, useState } from "react";
import "./LiveDetection.css";


type Box = [number, number, number, number];

type PersonDetection = {
  track_id: number;
  confidence: number;
  box: Box;
};

type PPEDetection = {
  class_name: string;
  confidence: number;
  box: Box;
};

type DetectionResult = {
  frame_width: number;
  frame_height: number;
  people: PersonDetection[];
  detections: PPEDetection[];
  error?: string;
};


export default function LiveDetection() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const overlayRef = useRef<HTMLCanvasElement | null>(null);
  const captureRef = useRef<HTMLCanvasElement | null>(null);

  const streamRef = useRef<MediaStream | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const timerRef = useRef<number | null>(null);
  const busyRef = useRef(false);

  const [cameraOn, setCameraOn] = useState(false);
  const [detecting, setDetecting] = useState(false);
  const [error, setError] = useState("");
  const [peopleCount, setPeopleCount] = useState(0);
  const [detectionCount, setDetectionCount] = useState(0);


  async function startCamera() {
    try {
      setError("");

      const stream =
        await navigator.mediaDevices.getUserMedia({
          video: {
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
          audio: false,
        });

      streamRef.current = stream;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }

      setCameraOn(true);
    } catch (err) {
      console.error(err);
      setError(
        "Could not access the camera. Check browser camera permissions."
      );
    }
  }


  function stopCamera() {
    stopDetection();

    streamRef.current?.getTracks().forEach(
      (track) => track.stop()
    );

    streamRef.current = null;

    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }

    const canvas = overlayRef.current;
    const ctx = canvas?.getContext("2d");

    if (canvas && ctx) {
      ctx.clearRect(
        0,
        0,
        canvas.width,
        canvas.height
      );
    }

    setCameraOn(false);
  }


  function drawResults(result: DetectionResult) {
    const canvas = overlayRef.current;

    if (!canvas) {
      return;
    }

    canvas.width = result.frame_width;
    canvas.height = result.frame_height;

    const ctx = canvas.getContext("2d");

    if (!ctx) {
      return;
    }

    ctx.clearRect(
      0,
      0,
      canvas.width,
      canvas.height
    );

    ctx.lineWidth = 3;
    ctx.font = "18px Arial";

    // Draw tracked people.
    result.people.forEach((person) => {
      const [x1, y1, x2, y2] = person.box;

      ctx.strokeStyle = "#3b82f6";
      ctx.fillStyle = "#3b82f6";

      ctx.strokeRect(
        x1,
        y1,
        x2 - x1,
        y2 - y1
      );

      ctx.fillText(
        `Person #${person.track_id}`,
        x1,
        Math.max(20, y1 - 8)
      );
    });

    // Draw PPE detections.
    result.detections.forEach((det) => {
      const [x1, y1, x2, y2] = det.box;

      const normalized =
        det.class_name.toLowerCase();

      const violation =
        normalized.startsWith("no-") ||
        normalized.startsWith("no_");

      ctx.strokeStyle =
        violation ? "#ef4444" : "#22c55e";

      ctx.fillStyle =
        violation ? "#ef4444" : "#22c55e";

      ctx.strokeRect(
        x1,
        y1,
        x2 - x1,
        y2 - y1
      );

      ctx.fillText(
        `${det.class_name} ${Math.round(
          det.confidence * 100
        )}%`,
        x1,
        Math.max(20, y1 - 8)
      );
    });

    setPeopleCount(result.people.length);
    setDetectionCount(result.detections.length);
  }


  function sendFrame() {
    const video = videoRef.current;
    const captureCanvas = captureRef.current;
    const socket = socketRef.current;

    if (
      !video ||
      !captureCanvas ||
      !socket ||
      socket.readyState !== WebSocket.OPEN ||
      busyRef.current ||
      video.videoWidth === 0
    ) {
      return;
    }

    busyRef.current = true;

    captureCanvas.width = video.videoWidth;
    captureCanvas.height = video.videoHeight;

    const ctx =
      captureCanvas.getContext("2d");

    if (!ctx) {
      busyRef.current = false;
      return;
    }

    ctx.drawImage(
      video,
      0,
      0,
      captureCanvas.width,
      captureCanvas.height
    );

    captureCanvas.toBlob(
      async (blob) => {
        if (!blob) {
          busyRef.current = false;
          return;
        }

        try {
          const arrayBuffer =
            await blob.arrayBuffer();

          socket.send(arrayBuffer);
        } catch (err) {
          console.error(err);
          busyRef.current = false;
        }
      },
      "image/jpeg",
      0.7
    );
  }


  function startDetection() {
    if (!cameraOn) {
      setError(
        "Start the camera before starting detection."
      );
      return;
    }

    setError("");

    const apiUrl =
  import.meta.env.VITE_API_URL
  ?? "http://127.0.0.1:8000/api";

const wsUrl = apiUrl
  .replace(/^http/, "ws")
  .replace(/\/$/, "");

const socket = new WebSocket(
  `${wsUrl}/live-detection/ws?camera_id=1`
);

    socketRef.current = socket;

    socket.onopen = () => {
      setDetecting(true);

      // Start conservatively at about 2 FPS.
      timerRef.current = window.setInterval(
        sendFrame,
        500
      );
    };

    socket.onmessage = (event) => {
      busyRef.current = false;

      try {
        const result: DetectionResult =
          JSON.parse(event.data);

        if (result.error) {
          setError(result.error);
          return;
        }

        drawResults(result);
      } catch (err) {
        console.error(err);
      }
    };

    socket.onerror = () => {
      busyRef.current = false;
      setError(
        "Live detection connection failed."
      );
    };

    socket.onclose = () => {
      busyRef.current = false;
      setDetecting(false);
    };
  }


  function stopDetection() {
    if (timerRef.current !== null) {
      window.clearInterval(
        timerRef.current
      );

      timerRef.current = null;
    }

    socketRef.current?.close();
    socketRef.current = null;

    busyRef.current = false;
    setDetecting(false);
  }


  useEffect(() => {
    return () => {
      stopDetection();

      streamRef.current
        ?.getTracks()
        .forEach(
          (track) => track.stop()
        );
    };
  }, []);


  return (
    <section className="live-page">
      <div className="live-heading">
        <div>
          <p className="live-eyebrow">
            REAL-TIME PPE MONITORING
          </p>

          <h1>Live Detection</h1>

          <p>
            Run SafeVision directly from your
            browser camera.
          </p>
        </div>

        <div
          className={
            detecting
              ? "live-status active"
              : "live-status"
          }
        >
          {detecting ? "● LIVE" : "OFFLINE"}
        </div>
      </div>

      {error && (
        <div className="live-error">
          {error}
        </div>
      )}

      <div className="camera-panel">
        <div className="camera-stage">
          <video
            ref={videoRef}
            muted
            playsInline
            className="live-video"
          />

          <canvas
            ref={overlayRef}
            className="live-overlay"
          />

          {!cameraOn && (
            <div className="camera-placeholder">
              Camera is off
            </div>
          )}
        </div>

        <canvas
          ref={captureRef}
          style={{ display: "none" }}
        />

        <div className="camera-controls">
          {!cameraOn ? (
            <button onClick={startCamera}>
              Start Camera
            </button>
          ) : (
            <button onClick={stopCamera}>
              Stop Camera
            </button>
          )}

          {!detecting ? (
            <button
              onClick={startDetection}
              disabled={!cameraOn}
            >
              Start Detection
            </button>
          ) : (
            <button
              onClick={stopDetection}
            >
              Stop Detection
            </button>
          )}
        </div>
      </div>

      <div className="live-stats">
        <div>
          <span>People tracked</span>
          <strong>{peopleCount}</strong>
        </div>

        <div>
          <span>Detections</span>
          <strong>{detectionCount}</strong>
        </div>

        <div>
          <span>Status</span>
          <strong>
            {detecting
              ? "Detecting"
              : "Idle"}
          </strong>
        </div>
      </div>
    </section>
  );
}