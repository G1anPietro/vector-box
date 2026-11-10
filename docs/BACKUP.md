# Nightly backup to the USB stick

`tools/backup.sh` copies, every night:

- **the database** (users, chat, private messages, books, games): a consistent copy made while the
  site is running, checked with `PRAGMA integrity_check`, compressed. The last 30 days are kept.
- **`.env`**: needed to restore. It contains passwords and secrets, so the stick stays at home.
- **the files in `data/`**: uploaded books, covers, logs (not the sessions).

The script refuses to run if the stick is not mounted, so it can never fill the internal disk.
The stick is a **second copy**: the live database stays on the internal disk (sticks wear out
with many small writes and break if unplugged).

Nothing here runs automatically until you do the steps below.

## 1. Find the stick

```bash
lsblk -f
```

Look for a ~238G device, e.g. `sdb` with a partition `sdb1`. Note its `FSTYPE` and `UUID`.

## 2. Format it (only if it is empty or you don't need what's on it)

**This erases the stick.** Check twice that `sdb1` is the stick and not a disk.

```bash
sudo mkfs.ext4 -L vbbackup /dev/sdb1
```

ext4 keeps Linux permissions; exFAT/FAT32 work too, but `.env` would not stay private.

## 3. Mount it at /mnt/usb, also after reboots

```bash
sudo mkdir -p /mnt/usb
sudo blkid /dev/sdb1          # copy the UUID="..." value
sudo nano /etc/fstab          # add this line, with your UUID:
```

```
UUID=xxxx-xxxx  /mnt/usb  ext4  defaults,nofail,noatime  0  2
```

`nofail` lets the server boot even if the stick is unplugged. Then:

```bash
sudo mount -a && mountpoint /mnt/usb    # must say "/mnt/usb is a mountpoint"
sudo mkdir -p /mnt/usb/vector-box-backups && sudo chmod 700 /mnt/usb/vector-box-backups
```

## 4. Try it once

```bash
sudo bash /var/www/vector-box/tools/backup.sh
ls -lh /mnt/usb/vector-box-backups/db
```

## 5. Every night at 03:30

```bash
echo '30 3 * * * root bash /var/www/vector-box/tools/backup.sh >> /var/log/vector-box-backup.log 2>&1' | sudo tee /etc/cron.d/vector-box-backup
```

Check it the next morning: `tail /var/log/vector-box-backup.log`.

## Restoring the database

```bash
cd /var/www/vector-box
sudo systemctl stop php8.5-fpm                       # nobody writes while you swap
sudo cp data/vector_uplink.sqlite /root/vector_uplink.before-restore.sqlite
gunzip -c /mnt/usb/vector-box-backups/db/vector_uplink-YYYY-MM-DD_HHMM.sqlite.gz | sudo tee data/vector_uplink.sqlite > /dev/null
sudo rm -f data/vector_uplink.sqlite-wal data/vector_uplink.sqlite-shm
sudo chown www-data:www-data data/vector_uplink.sqlite && sudo chmod 640 data/vector_uplink.sqlite
sudo systemctl start php8.5-fpm
```

## Options

Environment variables for `tools/backup.sh`: `BACKUP_MOUNT` (default `/mnt/usb`), `BACKUP_DIR`,
`KEEP_DAYS` (default 30), `PROJECT_DIR` (default `/var/www/vector-box`).

The Minecraft server now runs on the other machine under Crafty Controller, which has its own
scheduled backups (Crafty → server → Backups): use those for the worlds.
