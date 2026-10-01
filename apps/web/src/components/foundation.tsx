import type { ReactNode } from "react";
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Skeleton,
  Typography,
} from "@mui/material";
import CloudOffOutlinedIcon from "@mui/icons-material/CloudOffOutlined";
import ErrorOutlineIcon from "@mui/icons-material/ErrorOutlineOutlined";
import InboxOutlinedIcon from "@mui/icons-material/InboxOutlined";

type StateSurfaceProps = {
  title: string;
  message: string;
  action?: ReactNode;
};

export function PageContainer({ children }: { children: ReactNode }) {
  return <Box component="main" sx={{ flexGrow: 1, minWidth: 0, p: { xs: 2, md: 3 } }}>{children}</Box>;
}

export function PageHeader({ eyebrow, title, description, actions }: { eyebrow?: string; title: string; description?: string; actions?: ReactNode }) {
  return (
    <Box sx={{ alignItems: { sm: "flex-start" }, display: "flex", flexDirection: { xs: "column", sm: "row" }, gap: 2, justifyContent: "space-between", mb: 3 }}>
      <Box>
        {eyebrow && <Typography component="p" variant="overline" color="primary.main" sx={{ fontWeight: 800 }}>{eyebrow}</Typography>}
        <Typography component="h1" variant="h4">{title}</Typography>
        {description && <Typography color="text.secondary" sx={{ mt: 0.75, maxWidth: 760 }}>{description}</Typography>}
      </Box>
      {actions}
    </Box>
  );
}

export function SectionCard({ title, children, action }: { title?: string; children: ReactNode; action?: ReactNode }) {
  return (
    <Card component="section">
      <CardContent>
        {(title || action) && (
          <Box sx={{ alignItems: "center", display: "flex", gap: 2, justifyContent: "space-between", mb: 2 }}>
            {title ? <Typography component="h2" variant="h6">{title}</Typography> : <span />}
            {action}
          </Box>
        )}
        {children}
      </CardContent>
    </Card>
  );
}

export function LoadingState({ title, message }: Omit<StateSurfaceProps, "action">) {
  return (
    <SectionCard title={title}>
      <Box aria-busy="true" aria-live="polite" sx={{ display: "grid", gap: 1.5 }}>
        <Skeleton variant="text" width="42%" height={34} />
        <Skeleton variant="rounded" height={78} />
        <Typography color="text.secondary">{message}</Typography>
      </Box>
    </SectionCard>
  );
}

export function EmptyState({ title, message }: Omit<StateSurfaceProps, "action">) {
  return (
    <Box sx={{ alignItems: "center", display: "flex", flexDirection: "column", gap: 1.25, py: 3, textAlign: "center" }}>
      <InboxOutlinedIcon color="primary" fontSize="large" aria-hidden="true" />
      <Typography component="h2" variant="h6">{title}</Typography>
      <Typography color="text.secondary" sx={{ maxWidth: 520 }}>{message}</Typography>
    </Box>
  );
}

export function ErrorState({ title, message, action }: StateSurfaceProps) {
  return (
    <Box role="alert" sx={{ alignItems: "center", display: "flex", flexDirection: "column", gap: 1.25, py: 3, textAlign: "center" }}>
      <ErrorOutlineIcon color="error" fontSize="large" aria-hidden="true" />
      <Typography component="h2" variant="h6">{title}</Typography>
      <Typography color="text.secondary" sx={{ maxWidth: 520 }}>{message}</Typography>
      {action}
    </Box>
  );
}

export function OfflineNotice({ message }: { message: string }) {
  return <Alert icon={<CloudOffOutlinedIcon />} severity="warning" role="status">{message}</Alert>;
}

export function StatusChip({ online, label }: { online: boolean; label: string }) {
  return <Chip size="small" color={online ? "success" : "warning"} label={label} aria-label={label} />;
}

export function ScopeDialog({ open, title, description, closeLabel, onClose }: { open: boolean; title: string; description: string; closeLabel: string; onClose: () => void }) {
  return (
    <Dialog open={open} onClose={onClose} aria-labelledby="scope-dialog-title" fullWidth maxWidth="sm">
      <DialogTitle id="scope-dialog-title">{title}</DialogTitle>
      <DialogContent><Typography>{description}</Typography></DialogContent>
      <DialogActions><Button onClick={onClose} autoFocus>{closeLabel}</Button></DialogActions>
    </Dialog>
  );
}

export function BusyButton({ busy, children, ...props }: { busy: boolean; children: ReactNode } & React.ComponentProps<typeof Button>) {
  return <Button {...props} disabled={busy || props.disabled} startIcon={busy ? <CircularProgress size={18} color="inherit" /> : props.startIcon}>{children}</Button>;
}
