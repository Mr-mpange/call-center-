FROM andrius/asterisk:22@sha256:887595176c64d3bc10387f198b6248347cb5a91969f377b1b64641aeaf11acea

COPY config/ /etc/asterisk/
COPY entrypoint.sh /usr/local/bin/asterisk-entrypoint
RUN chmod 0755 /usr/local/bin/asterisk-entrypoint

EXPOSE 5060/udp 5060/tcp 8089/tcp 10000-10100/udp
ENTRYPOINT ["/usr/local/bin/asterisk-entrypoint"]
CMD ["/usr/sbin/asterisk", "-vvvdddf", "-T", "-W", "-U", "asterisk", "-p"]
