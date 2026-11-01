# GradeChecker บน Netlify (ไม่ใช้ Apps Script)

เด็กเปิดเว็บที่โดเมน Netlify อย่างเดียว ไม่ต้องติดต่อ script.google.com ส่วนการอ่าน/เขียน Google Sheet ทำฝั่งเซิร์ฟเวอร์ (Netlify Functions)

- นักเรียน: `https://<ชื่อเว็บ>.netlify.app/`
- ครู: `https://<ชื่อเว็บ>.netlify.app/teacher`

## ขั้นตอนติดตั้ง (ทำครั้งเดียว ~20 นาที)

### 1) สร้าง service account (บัญชีหุ่นยนต์ของ Google)
1. เข้า https://console.cloud.google.com → สร้างโปรเจกต์ใหม่ (ชื่ออะไรก็ได้)
2. เมนู APIs & Services → Library → เปิดใช้ **Google Sheets API** และ **Google Drive API**
3. APIs & Services → Credentials → Create credentials → **Service account** → ตั้งชื่อ → Done
4. กดเข้า service account นั้น → แท็บ Keys → Add key → Create new key → **JSON** → ไฟล์จะถูกดาวน์โหลด
5. คัดลอกอีเมลของ service account (ลงท้าย `...iam.gserviceaccount.com`)

### 2) แชร์ชีตและโฟลเดอร์รูปให้ service account
- เปิด Google Sheet GradeChecker → Share → ใส่อีเมล service account → สิทธิ์ **Editor**
- โฟลเดอร์รูปนักเรียนใน Drive (ไฟล์ตั้งชื่อ = เลขประจำตัว เช่น `69980020.jpg`) → Share → ใส่อีเมลเดียวกัน → สิทธิ์ **Viewer**
- คัดลอก **Sheet ID** จาก URL ของชีต (ช่วงระหว่าง `/d/` กับ `/edit`) และ **Folder ID** จาก URL ของโฟลเดอร์

### 3) ขึ้น Netlify
วิธีง่ายสุด: อัปโหลดโฟลเดอร์นี้ขึ้น GitHub แล้ว Netlify → Add new site → Import from Git (ไม่ต้องตั้ง build command เพิ่ม ไฟล์ netlify.toml ตั้งไว้แล้ว)
(อย่าใช้การลากโฟลเดอร์ใส่ Netlify Drop เพราะไม่ติดตั้งแพ็กเกจให้ฟังก์ชัน)

### 4) ตั้งค่า Environment variables (Site configuration → Environment variables)
| ชื่อ | ค่า |
|---|---|
| `SHEET_ID` | รหัสชีต |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | เปิดไฟล์ JSON ที่ดาวน์โหลดด้วยโปรแกรมจดบันทึก คัดลอกทั้งไฟล์มาวาง |
| `TEACHER_PASSWORD` | รหัสผ่านครู (อย่างน้อย 8 ตัวอักษร) |
| `PHOTO_FOLDER_ID` | รหัสโฟลเดอร์รูป (เว้นได้ถ้าไม่ใช้รูป) |

จากนั้นกด Deploys → Trigger deploy → Deploy site

### 5) เปิดใช้
เปิดหน้านักเรียนครั้งแรก 1 ครั้ง ระบบจะสร้างแท็บที่ขาดให้เอง (students, assignments, attendance, resetRequests, `_cache`, `_props`) และเปลี่ยนชื่อแท็บแรกเป็น `scores`
แล้วทดลองเข้า `/teacher` ด้วยรหัสครู

## ต้องรู้
- เปลี่ยนรหัสครู: แก้ `TEACHER_PASSWORD` แล้ว Deploy ใหม่ รหัสใหม่ใช้ได้ทันที
- อย่าลบหรือแก้แท็บ `_cache` และ `_props` (เก็บเซสชันกับรหัสครูแบบเข้ารหัส)
- ล็อกเอาต์ครูยกเลิกเซสชันได้ทันที ส่วนเซสชันนักเรียนหมดอายุเอง 6 ชั่วโมง
- ถ้ามีคนลงทะเบียนพร้อมกันหลายสิบคนในวินาทีเดียวกัน ให้ทดสอบก่อนใช้จริง (การบันทึกเพิ่มแถวปลอดภัย แต่การนับล็อกอินผิดอาจคลาดเคลื่อนเล็กน้อย)
- รูปไม่ขึ้นเมื่อไหร่ ให้ตรวจว่าแชร์โฟลเดอร์ให้ service account แล้ว
- ฟอนต์ Prompt โหลดจาก Google Fonts ถ้าโรงเรียนบล็อกจะใช้ฟอนต์สำรองของเครื่องแทน (ยังใช้งานได้ตามปกติ)
- ไฟล์ `netlify/functions/lib/Code.gs` คือตรรกะเดิมของระบบ ถ้าจะปรับกฎคะแนนให้แก้ที่ไฟล์นี้
