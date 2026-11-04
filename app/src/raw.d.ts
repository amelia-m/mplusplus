// A file imported with Vite's `?raw` suffix is its text, bundled into the app.
declare module '*?raw' {
  const text: string;
  export default text;
}
