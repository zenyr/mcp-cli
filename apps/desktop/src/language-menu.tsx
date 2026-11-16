import { Button, Menu } from "@mantine/core";
import { IconCheck, IconLanguage } from "@tabler/icons-react";
import { setLocale, t, useLocale } from "./i18n";
import type { Locale } from "../shared/i18n";

const LANGUAGES: Array<{ value: Locale; label: string }> = [
  { value: "en", label: "English" },
  { value: "ko", label: "한국어" },
  { value: "ja", label: "日本語" },
];

export const LanguageMenu = () => {
  const locale = useLocale();
  return (
    <Menu position="bottom-end" withinPortal>
      <Menu.Target>
        <Button
          variant="subtle"
          color="gray"
          size="compact-sm"
          leftSection={<IconLanguage size={16} />}
          aria-label={t("언어")}
        >
          {locale.toUpperCase()}
        </Button>
      </Menu.Target>
      <Menu.Dropdown>
        {LANGUAGES.map((language) => (
          <Menu.Item
            key={language.value}
            onClick={() => setLocale(language.value)}
            rightSection={language.value === locale ? <IconCheck size={14} /> : undefined}
          >
            {language.label}
          </Menu.Item>
        ))}
      </Menu.Dropdown>
    </Menu>
  );
};
