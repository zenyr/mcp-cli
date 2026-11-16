import { useCallback, useEffect, useState } from "react";
import { ActionIcon, Group, Tooltip } from "@mantine/core";
import { useHotkeys } from "@mantine/hooks";
import { IconArrowLeft, IconArrowRight } from "@tabler/icons-react";
import { useRouter } from "@tanstack/react-router";
import { t, useLocale } from "./i18n";

export const HistoryNavigation = () => {
  useLocale();
  const { history } = useRouter();
  const [position, setPosition] = useState(() => ({
    index: history.location.state.__TSR_index,
    last: history.location.state.__TSR_index,
  }));
  useEffect(
    () =>
      history.subscribe(({ location, action }) => {
        const index = location.state.__TSR_index;
        setPosition((previous) => ({
          index,
          last: action.type === "PUSH" ? index : Math.max(previous.last, index),
        }));
      }),
    [history],
  );
  const back = useCallback(() => {
    if (position.index > 0) history.back();
  }, [history, position.index]);
  const forward = useCallback(() => {
    if (position.index < position.last) history.forward();
  }, [history, position.index, position.last]);
  useHotkeys([
    ["mod+[", back],
    ["mod+]", forward],
    ["alt+ArrowLeft", back],
    ["alt+ArrowRight", forward],
  ]);
  useEffect(() => {
    const navigate = (event: MouseEvent) => {
      if (event.button !== 3 && event.button !== 4) return;
      event.preventDefault();
      if (event.button === 3) back();
      else forward();
    };
    window.addEventListener("mouseup", navigate);
    return () => window.removeEventListener("mouseup", navigate);
  }, [back, forward]);
  return (
    <Group gap={4} px="xs">
      <Tooltip label={t("뒤로가기")}>
        <ActionIcon
          variant="subtle"
          color="gray"
          aria-label={t("뒤로가기")}
          disabled={position.index === 0}
          onClick={back}
        >
          <IconArrowLeft size={18} />
        </ActionIcon>
      </Tooltip>
      <Tooltip label={t("앞으로가기")}>
        <ActionIcon
          variant="subtle"
          color="gray"
          aria-label={t("앞으로가기")}
          disabled={position.index >= position.last}
          onClick={forward}
        >
          <IconArrowRight size={18} />
        </ActionIcon>
      </Tooltip>
    </Group>
  );
};
