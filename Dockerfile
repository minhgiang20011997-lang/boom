FROM nginx:alpine
COPY index.html net.js game.js /usr/share/nginx/html/
COPY assets /usr/share/nginx/html/assets
