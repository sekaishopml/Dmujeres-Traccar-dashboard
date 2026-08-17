import { useEffect, useState } from 'react';
import { useSelector } from 'react-redux';
import { Link, Skeleton } from '@mui/material';
import { useTranslation } from './LocalizationProvider';
import { formatAddress } from '../util/formatter';
import { usePreference } from '../util/preferences';
import fetchOrThrow from '../util/fetchOrThrow';

const addressCache = new Map();

const geocode = async (latitude, longitude) => {
  const query = new URLSearchParams({ latitude, longitude });
  const response = await fetchOrThrow(`/api/server/geocode?${query.toString()}`);
  return response.text();
};

const AddressValue = ({ latitude, longitude, originalAddress }) => {
  const t = useTranslation();

  const addressEnabled = useSelector((state) => state.session.server.geocoderEnabled);
  const coordinateFormat = usePreference('coordinateFormat');

  const [address, setAddress] = useState(originalAddress);
  const [loading, setLoading] = useState(false);

  const cacheKey = `${latitude.toFixed(6)},${longitude.toFixed(6)}`;

  useEffect(() => {
    if (originalAddress) {
      setAddress(originalAddress);
      setLoading(false);
      return undefined;
    }
    if (addressCache.has(cacheKey)) {
      setAddress(addressCache.get(cacheKey));
      setLoading(false);
      return undefined;
    }
    setAddress(null);
    if (!addressEnabled) {
      return undefined;
    }
    setLoading(true);
    const timer = setTimeout(() => {
      geocode(latitude, longitude)
        .then((text) => {
          addressCache.set(cacheKey, text);
          setAddress(text);
        })
        .catch(() => setAddress(null))
        .finally(() => setLoading(false));
    }, 700);
    return () => clearTimeout(timer);
  }, [latitude, longitude, originalAddress, addressEnabled, cacheKey]);

  const showAddress = (event) => {
    event.preventDefault();
    setLoading(true);
    geocode(latitude, longitude)
      .then((text) => {
        addressCache.set(cacheKey, text);
        setAddress(text);
      })
      .catch(() => setAddress(null))
      .finally(() => setLoading(false));
  };

  if (address) {
    return address;
  }
  if (loading) {
    return <Skeleton variant="text" width={130} />;
  }
  if (addressEnabled) {
    return (
      <Link href="#" onClick={showAddress}>
        {t('sharedShowAddress')}
      </Link>
    );
  }
  return formatAddress({ latitude, longitude }, coordinateFormat);
};

export default AddressValue;
