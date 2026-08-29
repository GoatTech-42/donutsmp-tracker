FROM node:20-slim
WORKDIR /app
ENV NODE_ENV=production \
    NODE_OPTIONS="--max-old-space-size=512 --expose-gc" \
    DB_PATH=/app/data/pulse.db
COPY package.json package-lock.json* ./
RUN npm install --omit=dev
# Copy each lib file individually — Docker's COPY handles .dockerignore properly
COPY lib/ ./lib/
COPY public/ ./public/
COPY server.js ./
RUN mkdir -p /app/data && chown -R node:node /app/data
VOLUME ["/app/data"]
USER node
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 CMD node -e "fetch('http://127.0.0.1:3001/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "server.js"]
