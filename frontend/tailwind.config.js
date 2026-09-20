/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          50: "#eefcf7",
          100: "#d5f5e8",
          200: "#aeead4",
          300: "#78d9ba",
          400: "#43c19c",
          500: "#22a583",
          600: "#17856a",
          700: "#166a57",
          800: "#155447",
          900: "#13463c",
        },
      },
    },
  },
  plugins: [],
};
