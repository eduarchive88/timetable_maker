FROM node:20-bullseye

# Install Python and essential build tools
RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    python3-venv \
    build-essential \
    && apt-get clean \
    && ln -sf /usr/bin/python3 /usr/local/bin/python

WORKDIR /app

# Skip playwright browser download and prisma auto-generate during npm install
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
ENV PRISMA_SKIP_POSTINSTALL_GENERATE=true

# Install Node modules (use npm install instead of npm ci to handle lock file drift)
COPY package.json package-lock.json ./
RUN npm install

# Setup Python virtual environment
RUN python3 -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

# Install Python dependencies
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# Copy application files
COPY . .

# Build the Next.js application
RUN npm run build

# Expose the port Next.js runs on
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# Start the application
CMD ["node_modules/.bin/next", "start"]
