import { t, useLocale } from "./i18n";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Button,
  CopyButton,
  Group,
  Paper,
  SegmentedControl,
  Stack,
  Text,
} from "@mantine/core";
import { mount, register } from "pele/core";
import flowchart from "pele/diagrams/flowchart";
import type { CommandCatalog } from "@mcp-cli/core";
import { commandMermaid } from "./command-mermaid";

register(flowchart);

export const CommandDiagram = ({
  catalog,
  selected,
  onSelect,
}: {
  catalog: CommandCatalog;
  selected: string[];
  onSelect: (path: string[]) => void;
}) => {
  useLocale();
  const ref = useRef<HTMLDivElement>(null);
  const select = useRef(onSelect);
  useEffect(() => {
    select.current = onSelect;
  }, [onSelect]);
  const [scope, setScope] = useState<"all" | "groups">("all");
  const [failure, setFailure] = useState<string>();
  const diagram = useMemo(() => commandMermaid(catalog, scope === "groups"), [catalog, scope]);
  const selectedId = [...diagram.paths].find(
    ([, path]) => path.join(" ") === selected.join(" "),
  )?.[0];
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    setFailure(undefined);
    const mounted = mount(element, diagram.source, {
      zoom: {
        always: true,
        controls: true,
        labels: { zoomIn: t("확대"), zoomOut: t("축소"), reset: t("원래 크기") },
      },
      onError: (error) => setFailure(error instanceof Error ? error.message : String(error)),
    });
    const click = (event: MouseEvent) => {
      const target = event.target instanceof Element ? event.target.closest(".pele-node") : null;
      const path = diagram.paths.get(target?.getAttribute("data-id") ?? "");
      if (path) select.current(path);
    };
    element.addEventListener("click", click);
    return () => {
      element.removeEventListener("click", click);
      mounted.destroy();
    };
  }, [diagram]);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    element
      .querySelectorAll(".pele-node")
      .forEach((node) =>
        node.classList.toggle("selected", node.getAttribute("data-id") === selectedId),
      );
  }, [diagram, selectedId]);
  return (
    <Stack gap="sm">
      <Group justify="space-between">
        <SegmentedControl
          size="xs"
          value={scope}
          onChange={(value) => setScope(value === "groups" ? "groups" : "all")}
          data={[
            { value: "all", label: t("모든 명령") },
            { value: "groups", label: t("그룹만") },
          ]}
        />
        <CopyButton value={diagram.source}>
          {({ copied, copy }) => (
            <Button size="xs" variant="default" onClick={copy}>
              {copied ? t("복사했습니다") : t("Mermaid 복사")}
            </Button>
          )}
        </CopyButton>
      </Group>
      {failure && <Alert color="red">{failure}</Alert>}
      <Paper withBorder className="command-diagram" ref={ref} />
      <Text size="xs" c="dimmed">
        {t("노드를 누르면 해당 명령의 도움말로 이동합니다. 스크롤과 드래그로 확대하고 이동합니다.")}
      </Text>
    </Stack>
  );
};
