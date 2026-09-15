# NestJS 后端 Docker 镜像（en-server + en-ai）
FROM node:22-alpine

# Pronunciation canonical audio conversion (no network protocols enabled at invocation).
RUN apk add --no-cache ffmpeg

# 安装 PM2 进程管理
RUN npm install -g pm2

WORKDIR /app

# 复制构建产物（由 deploy.sh 在宿主机构建）
COPY dist/ ./server/dist/
COPY node_modules/ ./server/node_modules/
COPY package.json ./server/
COPY packages/ ./packages/

# PM2 配置
COPY ecosystem.config.js ./

EXPOSE 3000 3001

CMD ["pm2-runtime", "start", "ecosystem.config.js"]
