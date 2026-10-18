// Vite's `?raw` imports in the main process: the file's text, bundled at build time.
declare module '*?raw' {
  const content: string
  export default content
}
