FROM node:24-slim
ENV NODE_ENV=production
WORKDIR /app
COPY package.json server.js demo.js ./
COPY public ./public
COPY data ./data
EXPOSE 3000
CMD ["node", "--disable-warning=ExperimentalWarning", "server.js"]
