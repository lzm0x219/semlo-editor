export {};
declare global {
  interface Window {
    __semloRequireFixture<K extends keyof Window>(key: K): NonNullable<Window[K]>;
  }
}
