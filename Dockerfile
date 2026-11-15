# Unicorn Isles: vite preview serves the built app and the /api routes (search, Gemma, Cala).
FROM node:20-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build && chown -R 1000:1000 /app
USER 1000
ENV PORT=10000
EXPOSE 10000
CMD ["sh", "-c", "npx vite preview --host 0.0.0.0 --port $PORT --strictPort"]
