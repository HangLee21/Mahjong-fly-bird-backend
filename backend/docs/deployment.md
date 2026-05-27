# Deployment

Production should provide:

- HTTPS / WSS
- PostgreSQL
- Redis
- AI inference service
- `JWT_SECRET`
- `ADMIN_TOKEN`
- reverse proxy WebSocket upgrade support

Nginx example:

```nginx
location /ws {
    proxy_pass http://backend:3000/ws;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
}
```
