FROM nginxinc/nginx-unprivileged:stable-alpine

ENV WEB_DEMO_CONTROL_PLANE_URL=http://control-plane:8080

# nginx's entrypoint envsubst-renders /etc/nginx/templates/*.template,
# which lets the same image proxy either to the compose control-plane or
# to the k8s control-plane-offload NodePort/FQDN in production demo mode.
COPY nginx.conf /etc/nginx/templates/default.conf.template
COPY index.html service-views.html scalability.html styles.css app.js scalability.js scalability-data.json /usr/share/nginx/html/

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://localhost:8080/ >/dev/null || exit 1
