/// <reference types="vite/client" />

// Declare font file modules
declare module '*.woff2' {
  const content: string;
  export default content;
} 