module.exports = {
  darkMode: "class",
  content: ["./public/index.html", "./public/js/**/*.js"],
  theme: {
    extend: {
      fontFamily: {
        sans: [
          "Inter",
          "system-ui",
          "-apple-system",
          "Segoe UI",
          "sans-serif",
          "Apple Color Emoji",
          "Segoe UI Emoji",
        ],
      },
      colors: {
        tokyo: {
          bg: "var(--color-bg)",
          panel: "var(--color-panel)",
          card: "var(--color-card)",
          surface: "var(--color-surface)",
          crust: "var(--color-crust)",
          text: "var(--color-text)",
          muted: "var(--color-muted)",
          gray: "var(--color-gray)",
          blue: "var(--color-blue)",
          purple: "var(--color-purple)",
          green: "var(--color-green)",
          red: "var(--color-red)",
          orange: "var(--color-orange)",
          cyan: "var(--color-cyan)",
        },
      },
    },
  },
};
