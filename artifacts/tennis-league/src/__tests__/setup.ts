import "@testing-library/jest-dom";
import { vi } from "vitest";

// Radix UI components use pointer capture and scroll APIs that JSDOM doesn't implement.
if (!HTMLElement.prototype.hasPointerCapture) {
  HTMLElement.prototype.hasPointerCapture = vi.fn().mockReturnValue(false);
}
if (!HTMLElement.prototype.setPointerCapture) {
  HTMLElement.prototype.setPointerCapture = vi.fn();
}
if (!HTMLElement.prototype.releasePointerCapture) {
  HTMLElement.prototype.releasePointerCapture = vi.fn();
}
if (!HTMLElement.prototype.scrollIntoView) {
  HTMLElement.prototype.scrollIntoView = vi.fn();
}
// Radix UI Select uses getBoundingClientRect to compute dropdown position.
if (HTMLElement.prototype.getBoundingClientRect.toString().includes("native")) {
  HTMLElement.prototype.getBoundingClientRect = vi.fn(() => ({
    width: 200,
    height: 40,
    top: 0,
    left: 0,
    bottom: 40,
    right: 200,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  }));
}

class MockResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
Object.defineProperty(global, "ResizeObserver", {
  value: MockResizeObserver,
  writable: true,
  configurable: true,
});

class MockMediaRecorder {
  static isTypeSupported(_type: string) {
    return true;
  }
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  onerror: ((e: ErrorEvent) => void) | null = null;
  state: string = "inactive";

  constructor(_stream: MediaStream, _options?: MediaRecorderOptions) {}

  start(_timeslice?: number) {
    this.state = "recording";
  }

  stop() {
    this.state = "inactive";
    if (this.onstop) this.onstop();
  }

  pause() {
    this.state = "paused";
  }

  resume() {
    this.state = "recording";
  }
}

Object.defineProperty(global, "MediaRecorder", {
  value: MockMediaRecorder,
  writable: true,
});

const mockStream = {
  getTracks: () => [{ stop: () => undefined, kind: "video" }],
  getVideoTracks: () => [{ stop: () => undefined }],
  getAudioTracks: () => [],
} as unknown as MediaStream;

Object.defineProperty(global.navigator, "mediaDevices", {
  value: {
    getUserMedia: vi.fn().mockResolvedValue(mockStream),
    enumerateDevices: vi.fn().mockResolvedValue([]),
  },
  writable: true,
  configurable: true,
});

Object.defineProperty(URL, "createObjectURL", {
  value: vi.fn().mockReturnValue("blob:mock-url"),
  writable: true,
  configurable: true,
});
Object.defineProperty(URL, "revokeObjectURL", {
  value: vi.fn(),
  writable: true,
  configurable: true,
});

global.HTMLCanvasElement.prototype.getContext = vi.fn().mockReturnValue({
  drawImage: vi.fn(),
  toDataURL: vi.fn().mockReturnValue("data:image/jpeg;base64,mockdata"),
  fillRect: vi.fn(),
  clearRect: vi.fn(),
});

global.HTMLVideoElement.prototype.play = vi.fn().mockResolvedValue(undefined);
global.HTMLVideoElement.prototype.pause = vi.fn();
