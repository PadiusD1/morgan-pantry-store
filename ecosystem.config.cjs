module.exports = {
  apps: [{
    name: "morgan-pantry",
    script: "dist/index.cjs",
    cwd: "/opt/morgan-pantry",
    env: {
      NODE_ENV: "production",
    },
    max_restarts: 50,
    min_uptime: "10s",
    restart_delay: 3000,
    autorestart: true,
    watch: false,
    error_file: "/opt/morgan-pantry/logs/error.log",
    out_file: "/opt/morgan-pantry/logs/app.log",
    log_date_format: "YYYY-MM-DD HH:mm:ss Z",
    merge_logs: true,
    max_memory_restart: "512M",
  }],
};
