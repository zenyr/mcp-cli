export const sidebarSize = (startedOpened: boolean, width: number) => {
  const opened = width >= (startedOpened ? 120 : 32);
  return { opened, width: opened ? Math.max(168, width) : 8 };
};
