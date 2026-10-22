import { existsSync } from "node:fs";
import { rename, rm } from "node:fs/promises";

export type Replacement = { target: string; prepared: string };
export const replaceArtifacts = async (
  replacements: Replacement[],
  restart: () => Promise<void>,
  recover: () => Promise<void>,
  beforeRollback: () => Promise<void> = async () => {},
) => {
  const journal: Array<{
    target: string;
    backup: string;
    installed: boolean;
    existed: boolean;
    backedUp: boolean;
  }> = [];
  try {
    for (const { target, prepared } of replacements) {
      const entry = {
        target,
        backup: `${target}.previous-${crypto.randomUUID()}`,
        installed: false,
        backedUp: false,
        existed: existsSync(target),
      };
      journal.push(entry);
      if (entry.existed) {
        await rename(target, entry.backup);
        entry.backedUp = true;
      }
      await rename(prepared, target);
      entry.installed = true;
    }
    await restart();
  } catch (error) {
    try {
      await beforeRollback();
    } catch (stopError) {
      throw new AggregateError(
        [error, stopError],
        "새 앱을 종료하지 못해 복원을 중단했습니다. 백업을 보존합니다.",
      );
    }
    const failures: unknown[] = [error];
    for (const entry of [...journal].reverse()) {
      try {
        if (entry.installed) await rm(entry.target, { recursive: true, force: true });
        if (entry.backedUp) await rename(entry.backup, entry.target);
      } catch (rollbackError) {
        failures.push(rollbackError);
      }
    }
    if (failures.length === 1) {
      try {
        await recover();
      } catch (recoveryError) {
        failures.push(recoveryError);
      }
    }
    throw new AggregateError(failures, "앱 교체 실패. 이전 버전 복원 결과를 확인해 주세요.");
  }
  for (const entry of journal) await rm(entry.backup, { recursive: true, force: true });
};
