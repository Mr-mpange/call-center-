#!/bin/sh
set -eu
umask 027

: "${ARI_USERNAME:?Set ARI_USERNAME}"
: "${ARI_PASSWORD:?Set ARI_PASSWORD to a long random secret}"
: "${WEBRTC_AGENT_USERNAME:?Set WEBRTC_AGENT_USERNAME for local development}"
: "${WEBRTC_AGENT_PASSWORD:?Set WEBRTC_AGENT_PASSWORD for local development}"

mkdir -p /etc/asterisk/keys /etc/asterisk/runtime
if [ ! -s /etc/asterisk/runtime/pjsip-agents.conf ]; then
  : > /etc/asterisk/runtime/pjsip-agents.conf
fi
chown -R asterisk:asterisk /etc/asterisk/runtime 2>/dev/null || true
if [ ! -s /etc/asterisk/keys/asterisk.crt ] || [ ! -s /etc/asterisk/keys/asterisk.key ]; then
  openssl req -x509 -newkey rsa:3072 -sha256 -nodes -days 30 \
    -keyout /etc/asterisk/keys/asterisk.key \
    -out /etc/asterisk/keys/asterisk.crt \
    -subj "/CN=${ASTERISK_TLS_NAME:-localhost}" \
    -addext "subjectAltName=DNS:${ASTERISK_TLS_NAME:-localhost},IP:127.0.0.1"
fi
chown asterisk:asterisk /etc/asterisk/keys/asterisk.key
chmod 0640 /etc/asterisk/keys/asterisk.key
cp /opt/asterisk-config/http.conf /etc/asterisk/http.conf
cp /opt/asterisk-config/extensions.conf /etc/asterisk/extensions.conf
cp /opt/asterisk-config/rtp.conf /etc/asterisk/rtp.conf
cp /opt/asterisk-config/modules.conf /etc/asterisk/modules.conf
envsubst < /opt/asterisk-config/ari.conf.template > /etc/asterisk/ari.conf
envsubst < /opt/asterisk-config/pjsip.conf.template > /etc/asterisk/pjsip.conf
chown asterisk:asterisk /etc/asterisk/ari.conf /etc/asterisk/pjsip.conf
chmod 0640 /etc/asterisk/ari.conf /etc/asterisk/pjsip.conf
exec "$@"
