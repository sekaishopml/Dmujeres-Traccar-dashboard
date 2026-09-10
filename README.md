# [Traccar Web Interface](https://www.traccar.org)

## Overview

Traccar is open source server for various GPS tracking devices. This repository contains web interface for the Traccar platform. For back-end checkout [main Traccar repository](https://github.com/tananaev/traccar).

The app uses React, Material UI and MapLibre. For more information on how to build it please check the [web app documentation](https://www.traccar.org/build-web-app/).

## Team

- Anton Tananaev ([anton@traccar.org](mailto:anton@traccar.org))
- Andrey Kunitsyn ([andrey@traccar.org](mailto:andrey@traccar.org))

## DMujeres fork — panel de jornadas (MQTT/HTTP vistos desde el dashboard)

Este submódulo es el fork `Dmujeres-Traccar-dashboard` (rama `dev`).
Consume el canal móvil del server sin hablar MQTT directamente: todo llega por
la API REST y el WebSocket (`/api/socket`) del server.

### Canal MQTT (lo que el panel asume)

- La app publica en `dmj/v1/devices/{id}/telemetry` (QoS 1) y espera el ACK en
  `dmj/v1/devices/{id}/ack` (`accepted | duplicate | rejected | …`).
- El panel nunca ve estos tópicos: ve su efecto (posición nueva, `online`,
  atributos `mobile.*`).

### Envelope / idempotencia (visible en el panel)

- Envelope `schema: 1`, tipos `position | presence | ack`. El server deduplica
  por `sequence/messageId` (`tc_mobile_messages`): un replay offline aparece
  una sola vez en el mapa aunque la app lo reenvíe.
- `presence` (heartbeat sin GPS) no dibuja punto nuevo, pero sí refresca estado
  y telemetría (batería, red, pendientes).

### HTTP fallback

- `POST /api/mobile/v1/positions` (batch, `X-Api-Key`): la app lo usa sin
  MQTT; el panel lo ve igual que posiciones MQTT.
- `POST /api/mobile/provision` (solo admin): alta de colaboradora. El panel lo
  expone en `/settings/device` (campos `mobile.intervalSeconds`, `bufferMax`,
  `bufferPolicy`, `ackTimeoutSeconds`, `maxRetries`, ver `DevicePage.jsx`).

### Jornadas (lo que ve la operadora)

- En jornada + online: marcador verde (`success`, `getStatusColor('online')`
  en `common/util/formatter.js`, iconos `MapPositions.js`).
- Sin señal: marcador rojo (`error`, `getStatusColor('offline')`). Ojo: el rojo
  solo es alarma **fuera de jornada**; en jornada el silencio >2 min genera
  además evento `mobileNetworkLost` / `mobilePossiblePowerOff`.
- Fila de dispositivo (`main/DeviceRow.jsx`): estado (`online` o `hace X`),
  pendientes `mobile.pending` (aviso >50, error >100), batería `mobile.battery`
  (+ sparkline `mobile.batteryHistory` al seleccionar).
- Resumen (`main/DeviceSummary.jsx`): conteo online, batería baja, pendientes.
- Tiempo real: `SocketController.jsx` + `store/session.js` aplican cada
  `positions` del WebSocket sin recargar.

## License

    Apache License, Version 2.0

    Licensed under the Apache License, Version 2.0 (the "License");
    you may not use this file except in compliance with the License.
    You may obtain a copy of the License at

        http://www.apache.org/licenses/LICENSE-2.0

    Unless required by applicable law or agreed to in writing, software
    distributed under the License is distributed on an "AS IS" BASIS,
    WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
    See the License for the specific language governing permissions and
    limitations under the License.
