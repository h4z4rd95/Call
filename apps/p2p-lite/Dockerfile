FROM node:20-alpine

WORKDIR /app

COPY package.json ./
RUN corepack enable && pnpm install --frozen-lockfile=false

COPY . .

ENV PORT=3030
EXPOSE 3030

CMD ["pnpm", "start"]
