# Dockerfile
FROM node:20-slim

# Install dependencies
WORKDIR /usr/src/app
COPY package.json package-lock.json ./
RUN npm install

# Install curl for in-container testing and Playwright browsers
RUN apt-get update && apt-get install -y curl \
    && rm -rf /var/lib/apt/lists/*
# Install Playwright browsers and dependencies
RUN npx playwright install --with-deps

# Copy source code
COPY . .

# Expose port and start
EXPOSE 3000
CMD ["node", "agisci_scraper.js"]
