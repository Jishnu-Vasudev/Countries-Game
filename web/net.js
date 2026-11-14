// Room messaging over free public MQTT relays, so no game server has to be run.
// The first letter of a room code records which relay the room lives on.
window.Net = (function () {
  'use strict';
  const BROKERS = [
    'wss://broker.emqx.io:8084/mqtt',
    'wss://broker.hivemq.com:8884/mqtt',
    'wss://test.mosquitto.org:8081/mqtt'
  ];
  const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const TOPIC = 'countries-game-c7f3a/v1/';
  const pick = () => ALPHABET[Math.floor(Math.random() * ALPHABET.length)];

  function makeCode(brokerIndex) {
    let first;
    do { first = Math.floor(Math.random() * ALPHABET.length); }
    while (first % BROKERS.length !== brokerIndex);
    let code = ALPHABET[first];
    for (let i = 0; i < 4; i++) code += pick();
    return code;
  }

  function brokerOf(code) {
    const i = ALPHABET.indexOf(code[0]);
    return i < 0 ? -1 : i % BROKERS.length;
  }

  function isValidCode(code) {
    return code.length === 5 && [...code].every(ch => ALPHABET.includes(ch));
  }

  function connect(brokerIndex, code, handlers) {
    return new Promise((resolve, reject) => {
      const topic = TOPIC + code;
      const client = mqtt.connect(BROKERS[brokerIndex], { connectTimeout: 8000, reconnectPeriod: 2000, keepalive: 30, clean: true });
      let opened = false;
      const giveUp = setTimeout(() => { if (!opened) { client.end(true); reject(new Error('timeout')); } }, 9000);
      const channel = {
        code,
        send(message) { if (client.connected) client.publish(topic, JSON.stringify(message), { qos: 1 }); },
        close() { client.end(false); }
      };
      client.on('connect', () => {
        client.subscribe(topic, { qos: 1 }, err => {
          if (err) return;
          handlers.onStatus(true);
          if (!opened) { opened = true; clearTimeout(giveUp); resolve(channel); }
          else handlers.onReconnect();
        });
      });
      client.on('close', () => { if (opened) handlers.onStatus(false); });
      client.on('error', () => {});
      client.on('message', (_, payload) => {
        let message;
        try { message = JSON.parse(payload.toString()); } catch (e) { return; }
        if (message && typeof message === 'object') handlers.onMessage(message);
      });
    });
  }

  async function createRoom(handlers) {
    for (let i = 0; i < BROKERS.length; i++) {
      try { return await connect(i, makeCode(i), handlers); } catch (e) { /* try the next relay */ }
    }
    throw new Error('offline');
  }

  function joinRoom(code, handlers) {
    return connect(brokerOf(code), code, handlers);
  }

  return { createRoom, joinRoom, isValidCode };
})();
