FROM node:16 AS builder
VOLUME mr-img
LABEL maintainer="kyle@apollographql.com"
ENV NODE_ENV=production
WORKDIR /server


COPY *.* .
RUN npm install

CMD [ "node", "index.js" ]

COPY /server/tmp/*.* /tmp


###########
## NGINX ##
###########

FROM nginx:alpine
COPY nginx.conf /etc/nginx/conf.d/nginx.conf
WORKDIR /usr/share/nginx/html

RUN rm -rf ./*
# Copy built assets from builder stage into html folder for Nginx to serve
COPY --from=builder /tmp .

# Expose app on port 80...
EXPOSE 8080
# root user will run 'nginx: master process'
# nobody user will run 'nginx: worker process' as dictated in the nginx.non-root.conf
ENTRYPOINT ["nginx", "-g", "daemon off;"]