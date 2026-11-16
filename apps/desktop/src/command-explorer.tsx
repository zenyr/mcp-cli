import { t, useLocale } from "./i18n";
import { useMemo, useState } from "react";
import {
  ActionIcon,
  Anchor,
  Badge,
  Breadcrumbs,
  Code,
  CopyButton,
  Flex,
  Group,
  NavLink,
  Paper,
  ScrollArea,
  SimpleGrid,
  Stack,
  Text,
  TextInput,
  Tooltip,
  UnstyledButton,
} from "@mantine/core";
import { IconCheck, IconCopy, IconSearch } from "@tabler/icons-react";
import type { CommandCatalog, CommandNode } from "@mcp-cli/core";

type Select = (path: string[]) => void;
const key = (path: string[]) => path.join(" ");
const flatten = (node: CommandNode): CommandNode[] => [node, ...node.children.flatMap(flatten)];
const ancestors = (path: string[]) => path.map((_, index) => key(path.slice(0, index + 1)));
type Opened = (id: string) => boolean;

const kindLabel = (kind: CommandNode["kind"]) =>
  kind === "service"
    ? t("서비스")
    : kind === "group"
      ? t("그룹")
      : kind === "workflow"
        ? t("워크플로")
        : t("명령");

const Copy = ({ value }: { value: string }) => (
  <CopyButton value={value}>
    {({ copied, copy }) => (
      <Tooltip label={copied ? t("복사했습니다") : t("복사")}>
        <ActionIcon variant="subtle" color={copied ? "teal" : "gray"} onClick={copy}>
          {copied ? <IconCheck size={16} /> : <IconCopy size={16} />}
        </ActionIcon>
      </Tooltip>
    )}
  </CopyButton>
);

const TreeItem = ({
  node,
  selected,
  opened,
  onToggle,
  onSelect,
}: {
  node: CommandNode;
  selected: string;
  opened: Opened;
  onToggle: (path: string) => void;
  onSelect: Select;
}) => {
  const id = key(node.path);
  return (
    <NavLink
      label={node.path.at(-1)}
      title={node.summary}
      active={id === selected}
      opened={opened(id)}
      onClick={() => onSelect(node.path)}
      onChange={() => onToggle(id)}
      childrenOffset={12}
      py={3}
      styles={{ label: { fontFamily: "var(--mantine-font-family-monospace)", fontSize: 13 } }}
    >
      {node.children.length
        ? node.children.map((child) => (
            <TreeItem
              key={key(child.path)}
              node={child}
              selected={selected}
              opened={opened}
              onToggle={onToggle}
              onSelect={onSelect}
            />
          ))
        : undefined}
    </NavLink>
  );
};

const NodeRow = ({
  node,
  onSelect,
  prefix,
}: {
  node: CommandNode;
  onSelect: Select;
  prefix?: string;
}) => (
  <UnstyledButton className="command-row" onClick={() => onSelect(node.path)} p="xs">
    <Group gap="xs" wrap="nowrap">
      <Text size="sm" ff="monospace" fw={500} style={{ whiteSpace: "nowrap" }}>
        {prefix ? `${prefix} ` : ""}
        {prefix ? node.path.join(" ") : node.path.at(-1)}
      </Text>
      {node.kind !== "command" && (
        <Badge size="xs" variant="light" color={node.kind === "workflow" ? "grape" : "blue"}>
          {node.kind === "group" ? node.children.length : kindLabel(node.kind)}
        </Badge>
      )}
    </Group>
    <Text size="xs" c="dimmed" lineClamp={1}>
      {node.summary}
    </Text>
  </UnstyledButton>
);

export const CommandExplorer = ({
  catalog,
  path,
  onSelect,
}: {
  catalog: CommandCatalog;
  path: string[];
  onSelect: Select;
}) => {
  useLocale();
  const [query, setQuery] = useState("");
  const nodes = useMemo(() => flatten(catalog.root), [catalog]);
  const current = nodes.find((node) => key(node.path) === key(path)) ?? catalog.root;
  // Ancestors of the selection open by default until the user toggles them.
  const [toggled, setToggled] = useState(() => new Map<string, boolean>());
  const selectedAncestors = new Set(ancestors(current.path));
  const opened: Opened = (id) => toggled.get(id) ?? selectedAncestors.has(id);
  const toggle = (id: string) => setToggled((previous) => new Map(previous).set(id, !opened(id)));
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const matches = words.length
    ? nodes
        .filter((node) => node.path.length)
        .filter((node) =>
          words.every((word) =>
            `${key(node.path)} ${node.tool ?? ""} ${node.summary}`.toLowerCase().includes(word),
          ),
        )
        .slice(0, 40)
    : [];
  const command = key([catalog.service, ...current.path]);
  const pick = (next: string[]) => {
    setQuery("");
    setToggled((previous) => {
      const reset = new Map(previous);
      for (const id of ancestors(next)) reset.delete(id);
      return reset;
    });
    onSelect(next);
  };
  return (
    <Stack gap="sm">
      <TextInput
        leftSection={<IconSearch size={16} />}
        placeholder={t("명령, 도구 이름, 설명으로 검색")}
        value={query}
        onChange={(event) => setQuery(event.currentTarget.value)}
      />
      {words.length > 0 && (
        <Paper withBorder>
          {matches.length ? (
            <ScrollArea.Autosize mah={280}>
              <Stack gap={0}>
                {matches.map((node) => (
                  <NodeRow
                    key={key(node.path)}
                    node={node}
                    onSelect={pick}
                    prefix={catalog.service}
                  />
                ))}
              </Stack>
            </ScrollArea.Autosize>
          ) : (
            <Text size="sm" c="dimmed" p="sm">
              {t("일치하는 명령이 없습니다.")}
            </Text>
          )}
        </Paper>
      )}
      <Flex gap="md" align="flex-start" direction={{ base: "column", sm: "row" }}>
        <Paper withBorder w={{ base: "100%", sm: 220 }} style={{ flexShrink: 0 }}>
          <ScrollArea.Autosize mah={{ base: 220, sm: 560 }} type="auto">
            <Stack gap={0} p={4}>
              <NavLink
                label={catalog.service}
                active={!current.path.length}
                onClick={() => pick([])}
                py={3}
                styles={{
                  label: { fontFamily: "var(--mantine-font-family-monospace)", fontWeight: 600 },
                }}
              />
              {catalog.root.children.map((node) => (
                <TreeItem
                  key={key(node.path)}
                  node={node}
                  selected={key(current.path)}
                  opened={opened}
                  onToggle={toggle}
                  onSelect={pick}
                />
              ))}
            </Stack>
          </ScrollArea.Autosize>
        </Paper>
        <Stack gap="sm" style={{ flex: 1, minWidth: 0 }} w="100%">
          <Breadcrumbs separatorMargin={4}>
            {[catalog.service, ...current.path].map((part, index) => (
              <Anchor
                key={index}
                size="sm"
                ff="monospace"
                onClick={() => pick(current.path.slice(0, index))}
              >
                {part}
              </Anchor>
            ))}
          </Breadcrumbs>
          <Group gap="xs">
            <Badge variant="light">{kindLabel(current.kind)}</Badge>
            {current.tool && current.tool !== key(current.path) && (
              <Text size="xs" c="dimmed">
                {t("도구")} <Code>{current.tool}</Code>
              </Text>
            )}
          </Group>
          <Text size="sm">{current.summary}</Text>
          <Group gap={4} wrap="nowrap">
            <Code
              style={{ flex: 1, overflowX: "auto", whiteSpace: "nowrap" }}
            >{`${command} --help`}</Code>
            <Copy value={`${command} --help`} />
          </Group>
          {current.children.length > 0 && (
            <SimpleGrid cols={{ base: 1, md: 2 }} spacing={4} verticalSpacing={4}>
              {current.children.map((node) => (
                <NodeRow key={key(node.path)} node={node} onSelect={pick} />
              ))}
            </SimpleGrid>
          )}
          <Paper withBorder bg="var(--mantine-color-default-hover)">
            <Group justify="space-between" px="sm" pt={6}>
              <Text size="xs" c="dimmed" fw={500}>
                {t("CLI 도움말")}
              </Text>
              <Copy value={current.help} />
            </Group>
            <ScrollArea.Autosize mah={420} type="auto">
              <Text component="pre" className="command-help" px="sm" pb="sm" m={0}>
                {current.help}
              </Text>
            </ScrollArea.Autosize>
          </Paper>
        </Stack>
      </Flex>
    </Stack>
  );
};
