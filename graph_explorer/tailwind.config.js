export default {
  content: ["./public/**/*.html", "./public/**/*.js"],
  theme: {
    extend: {
      colors: {
        void: "#0d1117",
        cockpit: "#161b22",
        panel: "#161b22",
        panel2: "#0d1117",
        gridline: "#30363d",
        signal: "#2ea043",
        compromised: "#da3633",
        reachable: "#d29922"
      },
      fontFamily: {
        sans: ["Inter", "IBM Plex Sans", "ui-sans-serif", "system-ui"],
        mono: ["IBM Plex Mono", "SFMono-Regular", "Consolas", "monospace"]
      }
    }
  },
  plugins: []
};
