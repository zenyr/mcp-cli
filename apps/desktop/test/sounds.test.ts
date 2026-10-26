import { expect, test } from "bun:test";
import { soundDescriptions, soundKinds } from "../shared/ui-sounds";

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
