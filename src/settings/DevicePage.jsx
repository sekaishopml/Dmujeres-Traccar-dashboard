import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Accordion,
  AccordionSummary,
  AccordionDetails,
  Typography,
  FormControlLabel,
  Checkbox,
  TextField,
  Button,
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import FileInput from '../common/components/FileInput';
import EditItemView from './components/EditItemView';
import EditAttributesAccordion from './components/EditAttributesAccordion';
import SelectField from '../common/components/SelectField';
import deviceCategories from '../common/util/deviceCategories';
import { useTranslation } from '../common/components/LocalizationProvider';
import useDeviceAttributes from '../common/attributes/useDeviceAttributes';
import { useManager } from '../common/util/permissions';
import SettingsMenu from './components/SettingsMenu';
import useCommonDeviceAttributes from '../common/attributes/useCommonDeviceAttributes';
import { useCatch } from '../reactHelper';
import useSettingsStyles from './common/useSettingsStyles';
import QrCodeDialog from '../common/components/QrCodeDialog';
import fetchOrThrow from '../common/util/fetchOrThrow';

const DevicePage = () => {
  const { classes } = useSettingsStyles();
  const t = useTranslation();

  const manager = useManager();

  const commonDeviceAttributes = useCommonDeviceAttributes(t);
  const deviceAttributes = useDeviceAttributes(t);

  const [searchParams] = useSearchParams();
  const uniqueId = searchParams.get('uniqueId');

  const [item, setItem] = useState(uniqueId ? { uniqueId } : null);
  const [showQr, setShowQr] = useState(false);
  const [imageFile, setImageFile] = useState(null);
  const [mqttPassword, setMqttPassword] = useState('');

  const handleFileInput = useCatch(async (newFile) => {
    setImageFile(newFile);
    if (newFile && item?.id) {
      const response = await fetchOrThrow(`/api/devices/${item.id}/image`, {
        method: 'POST',
        body: newFile,
      });
      setItem({ ...item, attributes: { ...item.attributes, deviceImage: await response.text() } });
    } else if (!newFile) {
      // eslint-disable-next-line no-unused-vars
      const { deviceImage, ...remainingAttributes } = item.attributes || {};
      setItem({ ...item, attributes: remainingAttributes });
    }
  });

  const provisionCollaborator = useCatch(async () => {
    if (!item?.uniqueId || !mqttPassword) {
      window.alert('Escribe usuario y contraseña antes de crear el acceso.');
      return;
    }
    const intervalSeconds = Number(item.attributes?.['mobile.intervalSeconds'] || 10);
    const minIntervalSeconds = Number(item.attributes?.['mobile.minIntervalSeconds'] ?? 10);
    const distanceMeters = Number(item.attributes?.['mobile.distanceMeters'] ?? 10);
    const angleDegrees = Number(item.attributes?.['mobile.angleDegrees'] ?? 15);
    const accuracy = item.attributes?.['mobile.accuracy'] ?? 'high';
    const bufferEnabled = item.attributes?.['mobile.bufferEnabled'] ?? true;
    const bufferMax = Number(item.attributes?.['mobile.bufferMax'] || 5000);
    const bufferPolicy = item.attributes?.['mobile.bufferPolicy'] || 'drop_oldest';
    const ackTimeoutSeconds = Number(item.attributes?.['mobile.ackTimeoutSeconds'] || 15);
    const maxRetries = Number(item.attributes?.['mobile.maxRetries'] || 30);
    const response = await fetchOrThrow('/api/mobile/provision', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: item.uniqueId,
        password: mqttPassword,
        name: item.name || item.uniqueId,
        intervalSeconds,
        minIntervalSeconds,
        distanceMeters,
        angleDegrees,
        accuracy,
        bufferEnabled,
        bufferMax,
        bufferPolicy,
        ackTimeoutSeconds,
        maxRetries,
      }),
    });
    const provisioned = await response.json();
    setMqttPassword('');
    setItem({
      ...item,
      id: provisioned.deviceId,
      uniqueId: provisioned.username,
      attributes: {
        ...item.attributes,
        'mobile.intervalSeconds': provisioned.intervalSeconds,
        'mobile.minIntervalSeconds': provisioned.minIntervalSeconds ?? minIntervalSeconds,
        'mobile.distanceMeters': provisioned.distanceMeters ?? distanceMeters,
        'mobile.angleDegrees': provisioned.angleDegrees ?? angleDegrees,
        'mobile.accuracy': provisioned.accuracy ?? accuracy,
        'mobile.bufferEnabled': provisioned.bufferEnabled ?? bufferEnabled,
        'mobile.bufferMax': provisioned.bufferMax,
        'mobile.bufferPolicy': provisioned.bufferPolicy,
        'mobile.ackTimeoutSeconds': provisioned.ackTimeoutSeconds,
        'mobile.maxRetries': provisioned.maxRetries,
      },
    });
    window.alert(`Acceso creado. Entrega al colaborador\nUsuario: ${provisioned.username}`);
  });

  const validate = () => item && item.name && item.uniqueId;

  return (
    <EditItemView
      endpoint="devices"
      item={item}
      setItem={setItem}
      validate={validate}
      menu={<SettingsMenu />}
      breadcrumbs={['settingsTitle', 'sharedDevice']}
    >
      {item && (
        <>
          <Accordion defaultExpanded>
            <AccordionSummary expandIcon={<ExpandMoreIcon />}>
              <Typography variant="subtitle1">Acceso del colaborador</Typography>
            </AccordionSummary>
            <AccordionDetails className={classes.details}>
              <TextField
                value={item.uniqueId || ''}
                onChange={(event) => setItem({
                  ...item,
                  // El identificador va SIEMPRE en minúsculas: la app lo escribe
                  // así y el servidor busca por identificador exacto.
                  uniqueId: event.target.value.toLowerCase().replace(/\s+/g, ''),
                })}
                label="Usuario"
                helperText="Usuario del colaborador (minúsculas, sin espacios)"
                disabled={Boolean(uniqueId)}
              />
              <TextField
                value={mqttPassword}
                onChange={(event) => setMqttPassword(event.target.value)}
                label="Contraseña del colaborador"
                type="password"
                helperText="Solo se usa al crear; no se guarda en atributos"
              />
              <TextField
                value={item.attributes?.['mobile.intervalSeconds'] || 10}
                onChange={(event) =>
                  setItem({
                    ...item,
                    attributes: {
                      ...item.attributes,
                      'mobile.intervalSeconds': Number(event.target.value),
                    },
                  })
                }
                label="Frecuencia en movimiento (s)"
                type="number"
                inputProps={{ min: 15, max: 60 }}
                helperText="15 a 60 s mientras se mueve. Parado se pide cada 2 min para ahorrar batería"
              />
              <TextField
                value={item.attributes?.['mobile.minIntervalSeconds'] ?? 10}
                onChange={(event) =>
                  setItem({
                    ...item,
                    attributes: {
                      ...item.attributes,
                      'mobile.minIntervalSeconds': Number(event.target.value),
                    },
                  })
                }
                label="Intervalo mínimo (s)"
                type="number"
                inputProps={{ min: 3, max: 120 }}
                helperText="Cadencia mínima cuando hay movimiento"
              />
              <TextField
                value={item.attributes?.['mobile.distanceMeters'] ?? 10}
                onChange={(event) =>
                  setItem({
                    ...item,
                    attributes: {
                      ...item.attributes,
                      'mobile.distanceMeters': Number(event.target.value),
                    },
                  })
                }
                label="Distancia de movimiento (m)"
                type="number"
                inputProps={{ min: 0, max: 500 }}
                helperText="Solo se guarda un punto si se movió al menos esta distancia"
              />
              <TextField
                value={item.attributes?.['mobile.angleDegrees'] ?? 15}
                onChange={(event) =>
                  setItem({
                    ...item,
                    attributes: {
                      ...item.attributes,
                      'mobile.angleDegrees': Number(event.target.value),
                    },
                  })
                }
                label="Ángulo de cambio de rumbo (°)"
                type="number"
                inputProps={{ min: 0, max: 180 }}
              />
              <SelectField
                value={item.attributes?.['mobile.accuracy'] ?? 'high'}
                onChange={(event) =>
                  setItem({
                    ...item,
                    attributes: {
                      ...item.attributes,
                      'mobile.accuracy': event.target.value,
                    },
                  })
                }
                data={[
                  { id: 'high', name: 'Alta' },
                  { id: 'medium', name: 'Media' },
                  { id: 'low', name: 'Baja' },
                ]}
                label="Precisión"
              />
              <SelectField
                value={item.attributes?.['mobile.bufferEnabled'] ?? true}
                onChange={(event) =>
                  setItem({
                    ...item,
                    attributes: {
                      ...item.attributes,
                      'mobile.bufferEnabled': event.target.value,
                    },
                  })
                }
                data={[
                  { id: true, name: 'Sí' },
                  { id: false, name: 'No' },
                ]}
                label="Buffer activado"
                helperText="Guardar pendientes sin señal y reenviarlos al reconectar"
              />
              <TextField
                value={item.attributes?.['mobile.bufferMax'] || 5000}
                onChange={(event) =>
                  setItem({
                    ...item,
                    attributes: {
                      ...item.attributes,
                      'mobile.bufferMax': Number(event.target.value),
                    },
                  })
                }
                label="Buffer máximo"
                type="number"
                inputProps={{ min: 10, max: 10000 }}
                helperText="5000 ≈ 14 h sin señal a 10 s; 500 solo cubre ~80 min"
              />
              <SelectField
                value={item.attributes?.['mobile.bufferPolicy'] || 'drop_oldest'}
                onChange={(event) =>
                  setItem({
                    ...item,
                    attributes: {
                      ...item.attributes,
                      'mobile.bufferPolicy': event.target.value,
                    },
                  })
                }
                data={[
                  { id: 'drop_oldest', name: 'Descartar las más antiguas' },
                  { id: 'stop_capture', name: 'Detener captura' },
                ]}
                label="Política del buffer"
                helperText="Qué hace la app cuando se llena la memoria de pendientes"
              />
              <TextField
                value={item.attributes?.['mobile.ackTimeoutSeconds'] || 15}
                onChange={(event) =>
                  setItem({
                    ...item,
                    attributes: {
                      ...item.attributes,
                      'mobile.ackTimeoutSeconds': Number(event.target.value),
                    },
                  })
                }
                label="Tiempo de espera (segundos)"
                type="number"
                inputProps={{ min: 5, max: 60 }}
                helperText="Cuánto espera la app la confirmación del servidor antes de reintentar"
              />
              <TextField
                value={item.attributes?.['mobile.maxRetries'] || 30}
                onChange={(event) =>
                  setItem({
                    ...item,
                    attributes: {
                      ...item.attributes,
                      'mobile.maxRetries': Number(event.target.value),
                    },
                  })
                }
                label="Reintentos máximos"
                type="number"
                inputProps={{ min: 3, max: 200 }}
                helperText="Intentos de envío de cada ubicación antes de descartarla"
              />
              <Typography variant="caption" color="textSecondary">
                La app toma estos cambios sola: consulta la configuración al abrir y cada 10
                minutos, sin actualizar la app.
              </Typography>
              <Button
                variant="contained"
                color="primary"
                onClick={provisionCollaborator}
                disabled={!item.uniqueId || !mqttPassword}
              >
                Crear acceso y dispositivo
              </Button>
            </AccordionDetails>
          </Accordion>
          <Accordion>
            <AccordionSummary expandIcon={<ExpandMoreIcon />}>
              <Typography variant="subtitle1">{t('sharedExtra')}</Typography>
            </AccordionSummary>
            <AccordionDetails className={classes.details}>
              <SelectField
                value={item.groupId}
                onChange={(event) => setItem({ ...item, groupId: Number(event.target.value) })}
                endpoint="/api/groups"
                label={t('groupParent')}
              />
              <TextField
                value={item.phone || ''}
                onChange={(event) => setItem({ ...item, phone: event.target.value })}
                label={t('sharedPhone')}
              />
              <TextField
                value={item.model || ''}
                onChange={(event) => setItem({ ...item, model: event.target.value })}
                label={t('deviceModel')}
              />
              <TextField
                value={item.contact || ''}
                onChange={(event) => setItem({ ...item, contact: event.target.value })}
                label={t('deviceContact')}
              />
              <SelectField
                value={item.category || 'default'}
                onChange={(event) => setItem({ ...item, category: event.target.value })}
                data={deviceCategories
                  .map((category) => ({
                    id: category,
                    name: t(`category${category.replace(/^\w/, (c) => c.toUpperCase())}`),
                  }))
                  .sort((a, b) => a.name.localeCompare(b.name))}
                label={t('deviceCategory')}
              />
              <SelectField
                value={item.calendarId}
                onChange={(event) => setItem({ ...item, calendarId: Number(event.target.value) })}
                endpoint="/api/calendars"
                label={t('sharedCalendar')}
              />
              <TextField
                label={t('userExpirationTime')}
                type="date"
                value={item.expirationTime ? item.expirationTime.split('T')[0] : '2099-01-01'}
                onChange={(e) => {
                  if (e.target.value) {
                    setItem({ ...item, expirationTime: new Date(e.target.value).toISOString() });
                  }
                }}
                disabled={!manager}
              />
              <FormControlLabel
                control={
                  <Checkbox
                    checked={item.disabled}
                    onChange={(event) => setItem({ ...item, disabled: event.target.checked })}
                  />
                }
                label={t('sharedDisabled')}
                disabled={!manager}
              />
              <Button variant="outlined" color="primary" onClick={() => setShowQr(true)}>
                {t('sharedQrCode')}
              </Button>
            </AccordionDetails>
          </Accordion>
          {item.id && (
            <Accordion>
              <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                <Typography variant="subtitle1">{t('attributeDeviceImage')}</Typography>
              </AccordionSummary>
              <AccordionDetails className={classes.details}>
                <FileInput
                  placeholder={t('attributeDeviceImage')}
                  value={imageFile}
                  onChange={handleFileInput}
                  slotProps={{ htmlInput: { accept: 'image/*' } }}
                />
              </AccordionDetails>
            </Accordion>
          )}
          <EditAttributesAccordion
            attributes={item.attributes}
            setAttributes={(attributes) => setItem({ ...item, attributes })}
            definitions={{ ...commonDeviceAttributes, ...deviceAttributes }}
          />
        </>
      )}
      <QrCodeDialog open={showQr} onClose={() => setShowQr(false)} />
    </EditItemView>
  );
};

export default DevicePage;
