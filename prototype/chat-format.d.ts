export {};
declare global {
  var ZhixuChatFormatting: {
    display(value: string): string;
    parse(value: string): { reply: string; actions: unknown[]; warnings: string[] };
  };
}
