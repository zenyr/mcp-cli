import { expect, test } from "bun:test";
import { createSoundController } from "../shared/sound-controller";
import { soundDescriptions, soundKinds } from "../shared/ui-sounds";

test("mute blocks every sound and invalidates pending playback", async () => {
  const played: string[] = [];
  let release = (_played: boolean) => {};
  const control = createSoundController({
    play: (kind) => {
      played.push(kind);
      return new Promise<boolean>((resolve) => {
        release = resolve;
      });
    },
  });
  control.setEnabled(false);
  for (const kind of soundKinds) expect(await control.play(kind)).toBe(false);
  expect(played).toEqual([]);
  control.setEnabled(true);
  const pending = control.play("click");
  control.setEnabled(false);
  control.setEnabled(true);
  release(true);
  expect(await pending).toBe(false);
});

test("click and feedback start immediately even while another sound is playing", async () => {
  let now = 0;
  const played: { kind: string; at: number }[] = [];
  const control = createSoundController({
    now: () => now,
    play: async (kind) => {
      played.push({ kind, at: now });
      return true;
    },
  });
  expect(await control.play("hover")).toBe(true);
  now = 20;
  expect(await control.play("click")).toBe(true);
  now = 30;
  expect(await control.play("success")).toBe(true);
  expect(await control.play("hover")).toBe(false);
  now = 240;
  expect(await control.play("hover")).toBe(true);
  expect(played).toEqual([
    { kind: "hover", at: 0 },
    { kind: "click", at: 20 },
    { kind: "success", at: 30 },
    { kind: "hover", at: 240 },
  ]);
});

test("start plays once for a new daemon and stays silent on the initial running daemon", async () => {
  const played: string[] = [];
  let now = 0;
  const control = createSoundController({
    now: () => now,
    play: async (kind) => {
      played.push(kind);
      return true;
    },
  });
  expect(await control.observeDaemon(101)).toBe(false);
  expect(await control.observeDaemon(101)).toBe(false);
  expect(await control.observeDaemon(null)).toBe(false);
  expect(await control.observeDaemon(202)).toBe(true);
  expect(await control.observeDaemon(202)).toBe(false);
  expect(played).toEqual(["start"]);
  control.setEnabled(false);
  expect(await control.observeDaemon(303)).toBe(false);
  control.setEnabled(true);
  expect(await control.observeDaemon(303)).toBe(false);
});

test("audio failure does not poison the next UI sound", async () => {
  let calls = 0;
  const control = createSoundController({
    play: async () => {
      calls += 1;
      if (calls === 1) throw new Error("device unavailable");
      return true;
    },
  });
  expect(await control.play("click")).toBe(false);
  expect(await control.play("success")).toBe(true);
});

test("selected BBB AA WAVs are mono PCM with exact durations, bounded peaks, and silent ends", async () => {
  expect(soundKinds.map((kind) => soundDescriptions[kind].id)).toEqual([
    "start-b",
    "hover-b",
    "click-b",
    "success-a",
    "error-a",
  ]);
  for (const kind of soundKinds) {
    const sound = soundDescriptions[kind];
    const wav = Buffer.from(
      await Bun.file(new URL(`../assets/sounds/${sound.id}.wav`, import.meta.url)).bytes(),
    );
    expect(wav.toString("ascii", 0, 4)).toBe("RIFF");
    expect(wav.readUInt16LE(20)).toBe(1);
    expect(wav.readUInt16LE(22)).toBe(1);
    expect(wav.readUInt32LE(24)).toBe(48_000);
    expect(wav.readUInt16LE(34)).toBe(16);
    expect((wav.length - 44) / 96).toBeCloseTo(sound.durationMs, 4);
    expect(wav.readInt16LE(44)).toBe(0);
    expect(wav.readInt16LE(wav.length - 2)).toBe(0);
    let peak = 0;
    for (let offset = 44; offset < wav.length; offset += 2)
      peak = Math.max(peak, Math.abs(wav.readInt16LE(offset)) / 32767);
    expect(peak).toBeGreaterThan(0.05);
    expect(peak).toBeLessThanOrEqual(0.25);
  }
});
