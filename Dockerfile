FROM node:16.13.1-alpine3.14

# Create app directory
WORKDIR /usr/src/app

# Bundle app source
# Copy package.json, package-lock.json (for dependencies) AND the rest of our source.
# We do not copy only package.json and package-lock.json, which would presumably permit reusing an image layer when only
# our code changes and not our dependencies, because at each release we bump the version in package.json and that voids
# the whole reusability.
COPY . .

# Install dependencies
RUN set -eux \
    && npm ci --only=production

CMD [ "node", "index.js" ]
