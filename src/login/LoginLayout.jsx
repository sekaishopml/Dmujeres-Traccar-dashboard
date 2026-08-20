import { Paper, Typography } from '@mui/material';
import { makeStyles } from 'tss-react/mui';

const useStyles = makeStyles()((theme) => ({
  root: {
    display: 'flex',
    height: '100%',
    background: theme.palette.background.default,
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
    padding: theme.spacing(2),
  },
  panel: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    width: '100%',
    maxWidth: theme.spacing(52),
    padding: theme.spacing(5, 4),
    borderRadius: theme.spacing(2),
    boxShadow: '0 8px 28px rgba(0, 0, 0, 0.14)',
  },
  logo: {
    width: 'min(280px, 80%)',
    maxHeight: '120px',
    objectFit: 'contain',
    marginBottom: theme.spacing(4),
  },
  form: {
    width: '100%',
  },
  version: {
    position: 'fixed',
    left: theme.spacing(2),
    bottom: theme.spacing(2),
    color: theme.palette.text.secondary,
  },
}));

const LoginLayout = ({ children }) => {
  const { classes } = useStyles();
  const version = import.meta.env.VITE_APP_VERSION;

  return (
    <main className={classes.root}>
      <Paper className={classes.panel}>
        <img className={classes.logo} src="/logo-banner.png" alt="DMujeres" />
        <form className={classes.form}>{children}</form>
      </Paper>
      <Typography variant="caption" className={classes.version}>
        {`@DMujeres Tracking v${version}`}
      </Typography>
    </main>
  );
};

export default LoginLayout;
