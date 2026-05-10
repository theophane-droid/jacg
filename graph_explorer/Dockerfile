FROM node:22-alpine

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev

COPY tailwind.config.js ./
COPY src ./src
COPY server.js ./
COPY public ./public
RUN npm run build:css

ENV PORT=3000
EXPOSE 3000

CMD ["node", "server.js"]
