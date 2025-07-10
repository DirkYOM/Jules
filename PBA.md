Absolutely — here’s a **comprehensive, production-grade `BOOT_SETUP.md`** that includes:

* **Context** – why these steps are needed (PBA, Access Guard, OPAL, etc.)
* **Objectives** – what we’re trying to achieve
* **Implementation plan** – detailed, step-by-step
* **Validation checklist** – how to confirm everything worked
* **Troubleshooting** – common failure cases

---

````markdown
# Exascend PSSD – Boot Setup & Secure Boot Integration Guide

## 🎯 Purpose

This guide explains how to prepare a **pre-flashed Ubuntu system image** to:

- Boot **securely and reliably** on any UEFI host
- Work with **Exascend’s Access Guard** (Pre-Boot Authentication)
- Remain compatible with **Secure Boot**
- Require **no OS modification**
- Be resilient across **BIOS resets**, **machine changes**, and **drive cloning**

---

## 🔐 Background: PBA, Access Guard, and Boot Implications

Exascend PSSDs may ship with **Pre-Boot Authentication (PBA)** enabled via **Access Guard** or **TCG Opal**:

| Mechanism       | Behavior |
|-----------------|----------|
| **Access Guard** (host-auth) | Verifies the host via an HMAC handshake. If it fails, the SSD stays locked and the OS is hidden. |
| **OPAL** (user-auth)         | Requires a password to unlock the bootable region, often via a shadow MBR or pre-boot partition. |

➡️ This means **the OS must reside on the same PSSD**, but the firmware has to **boot before the OS is accessible**.  
To handle this, we install a **UEFI bootloader (shim + GRUB) into the EFI System Partition (ESP)** that:

- Is available before the OS boots
- Supports Secure Boot (via Ubuntu's signed `shimx64.efi`)
- Uses the fallback UEFI boot path (`EFI/BOOT/BOOTX64.EFI`)
- Optionally installs a persistent Boot#### entry (NVRAM)

---

## ✅ High-Level Goals

| Goal | Requirement |
|------|-------------|
| **Boot Ubuntu from the same PSSD it's installed on** | PBA prevents external OS |
| **Survive BIOS resets / host changes** | Use fallback bootloader (`BOOTX64.EFI`) |
| **Pass Secure Boot validation** | Use Ubuntu’s signed `shimx64.efi` |
| **Avoid reliance on internal host storage** | Everything self-contained on the PSSD |
| **Enable automatic boot when PSSD is present** | UEFI Boot#### entry OR fallback |
| **Fallback to Windows if PSSD is missing** | Ensure Windows stays second in boot order |

---

## 🧱 Expected Partition Layout (After Flashing)

| Partition | Type     | Purpose                           |
|-----------|----------|-----------------------------------|
| 1         | `msgrub` | Optional GRUB BIOS platform (not used with UEFI) |
| 2         | `ESP`    | FAT32 EFI System Partition        |
| 3         | `Main`   | EXT4 root filesystem (`/`)        |

---

## 🛠 Post-Flash Setup Plan

After flashing your `.raw` Ubuntu image and resizing the filesystem, you **must perform the following steps**.

### 1. Identify ESP Partition

Use `lsblk` or `blkid` to confirm the ESP (usually partition 2):

```bash
lsblk -o NAME,PARTLABEL,FSTYPE,MOUNTPOINT
````

### 2. Mount the ESP

```bash
ESP_DEV=/dev/sdX2           # Adjust for actual ESP
ESP_MNT=/mnt/esp-temp

mkdir -p "$ESP_MNT"
mount "$ESP_DEV" "$ESP_MNT"
```

### 3. Install Fallback UEFI Bootloader

This copies the signed bootloader (`shimx64.efi`) to the fallback path:

```bash
grub-install --target=x86_64-efi \
  --efi-directory="$ESP_MNT" \
  --removable
```

✅ Creates: `EFI/BOOT/BOOTX64.EFI`
✅ Ensures boot compatibility even if BIOS forgets Boot#### entries
✅ Works with Secure Boot by default

### 4. Unmount

```bash
umount "$ESP_MNT"
rmdir "$ESP_MNT"
```

---

## (Optional) 5. Add Boot Entry for This Host

Only if this PSSD will be booted on the same host it's flashed on:

```bash
efibootmgr -c -d /dev/sdX -p 2 \
  -L "NodeOS" -l '\EFI\ubuntu\shimx64.efi'
```

Creates a persistent UEFI boot entry labeled **NodeOS**.

---

## 🧪 Validation Checklist

Once the PSSD is flashed and configured, validate with the following:

### 🖥 Host-side checks

* [ ] PSSD shows up in BIOS/UEFI boot menu
* [ ] Boot entry named “NodeOS” appears in `efibootmgr`
* [ ] PSSD boots automatically when inserted
* [ ] Windows boots automatically when PSSD is removed

### 🔐 Secure Boot validation

* [ ] Secure Boot is **enabled**
* [ ] PSSD boots successfully without disabling Secure Boot
* [ ] `BOOTX64.EFI` exists and is signed:

  ```bash
  pesign --show-signature -i /boot/efi/EFI/BOOT/BOOTX64.EFI
  ```

### 🔒 PBA / Access Guard validation

* [ ] When PSSD is moved to another PC, it does **not unlock**
* [ ] After Access Guard accepts host, PSSD appears as bootable
* [ ] OPAL password (if configured) prompts before GRUB
* [ ] Shadow MBR hides data when locked

---

## 🧯 Troubleshooting

| Problem                               | Cause                         | Fix                                 |
| ------------------------------------- | ----------------------------- | ----------------------------------- |
| Ubuntu doesn’t boot                   | Missing fallback loader       | Run `grub-install --removable`      |
| Secure Boot blocks boot               | You installed unsigned GRUB   | Use Ubuntu’s `shimx64.efi`          |
| Only boots via F12                    | No Boot#### entry created     | Use `efibootmgr`                    |
| Boots Windows even with PSSD inserted | Boot order incorrect          | Move “NodeOS” above Windows in BIOS |
| Black screen after BIOS update        | Boot order was wiped          | Fallback loader should still work   |
| Drive doesn't unlock                  | Access Guard handshake failed | Recheck host HMAC / PSSD firmware   |

---

## 📦 Summary

| Task                        | Why it's needed                                |
| --------------------------- | ---------------------------------------------- |
| Fallback loader install     | Enables boot without relying on Boot#### NVRAM |
| Secure Boot compatibility   | Prevents firmware from blocking unsigned GRUB  |
| ESP validation and mounting | Ensures correct install path                   |
| efibootmgr (optional)       | Adds boot entry for this specific host         |
| Partition growth post-flash | Maximizes usable space on PSSD                 |

---

## 🔚 Notes

* This setup requires **no kernel changes, no OS hooks**, and no runtime overhead.
* All boot logic occurs **before** the OS loads, satisfying Exascend’s authentication model.
* Works with **Access Guard**, **Opal**, and **Secure Boot**.

```

---

Let me know if you’d like this converted into a downloadable `.md` file or paired with a bash installer script.
```
