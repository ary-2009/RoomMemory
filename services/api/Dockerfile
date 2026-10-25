FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY services/api/package.json ./package.json
RUN npm install --omit=dev && npm cache clean --force
COPY cloud/services/api/src/index.js ./src/index.js
USER node
EXPOSE 8080
CMD ["node", "src/index.js"]
