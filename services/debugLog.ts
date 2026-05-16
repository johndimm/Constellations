const isDebug = (): boolean =>
  typeof window !== "undefined" && !!localStorage.getItem("constellations:debug");

export const dlog = (...args: unknown[]): void => {
  if (isDebug()) console.log(...args);
};
