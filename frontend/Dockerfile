FROM node:20-slim

WORKDIR /app

COPY package.json ./
RUN npm install

COPY . .

# Next.js bakes NEXT_PUBLIC_* vars into the client bundle at build time, not
# runtime — a platform env var set in the dashboard isn't visible inside
# `docker build` unless it's threaded through as a build ARG like this.
ARG NEXT_PUBLIC_API_URL
ARG NEXT_PUBLIC_API_KEY
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_API_KEY=$NEXT_PUBLIC_API_KEY

RUN npm run build

EXPOSE 3000
CMD ["npm", "start"]
