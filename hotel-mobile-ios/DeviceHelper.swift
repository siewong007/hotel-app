# Device Testing Guide

## 📱 Testing the Hotel Management iOS App Across Apple Devices

This guide covers testing strategies and device-specific considerations for the Hotel Management iOS app.

---

## 🎯 Supported Devices

### iPhone
- ✅ iPhone SE (2nd gen and later)
- ✅ iPhone 8, 8 Plus
- ✅ iPhone X, XR, XS, XS Max
- ✅ iPhone 11, 11 Pro, 11 Pro Max
- ✅ iPhone 12 mini, 12, 12 Pro, 12 Pro Max
- ✅ iPhone 13 mini, 13, 13 Pro, 13 Pro Max
- ✅ iPhone 14, 14 Plus, 14 Pro, 14 Pro Max
- ✅ iPhone 15, 15 Plus, 15 Pro, 15 Pro Max

### iPad
- ✅ iPad (9th generation and later)
- ✅ iPad Air (4th generation and later)
- ✅ iPad Pro (all sizes)
- ✅ iPad mini (6th generation and later)

### Minimum Requirements
- **iOS/iPadOS**: 15.0 or later
- **Swift**: 5.9+
- **Xcode**: 14.0+

---

## 🧪 Testing Checklist

### Pre-Testing Setup

#### 1. Backend Server Configuration

**For Simulator Testing**:
```swift
// Settings → Server URL
http://localhost:3030
```

**For Physical Device Testing**:
```swift
// Find your computer's IP address:
// macOS: System Settings → Network → Details → TCP/IP
// Use IP address like: http://192.168.1.XXX:3030
```

#### 2. Network Configuration

Ensure your device and Mac are on the same network:
- Same WiFi network for physical devices
- Firewall allows incoming connections on port 3030
- Backend server is accessible from network

---

## 📱 iPhone Testing

### iPhone SE / Small Screens (320-375pt width)

**Test Focus**:
- [ ] All UI elements visible without truncation
- [ ] Stack views don't overflow
- [ ] Text fields are tappable
- [ ] Buttons have adequate size (44pt minimum)
- [ ] Table cells display content properly
- [ ] Swipe actions are accessible

**Known Considerations**:
- Login form should fit without scrolling
- Guest/Booking lists may show less content per screen
- Alert dialogs should be compact

**Test Cases**:
```
1. Launch app on iPhone SE simulator
2. Login with credentials
3. Navigate through all tabs
4. Create a guest (check form fits)
5. View booking details (check text fits)
6. Test swipe actions on small cell
7. Rotate to landscape (optional feature)
```

---

### iPhone 12/13/14/15 (Standard Sizes)

**Test Focus**:
- [ ] Safe area handling (notch/Dynamic Island)
- [ ] Navigation bar appearance
- [ ] Tab bar visibility
- [ ] Keyboard avoidance
- [ ] Pull-to-refresh feels natural

**Test Cases**:
```
1. Check navigation bar doesn't overlap notch
2. Test keyboard appearance (login, create guest)
3. Verify tab bar at bottom (not behind home indicator)
4. Test pull-to-refresh on all lists
5. Test swipe actions work smoothly
```

---

### iPhone Pro Max / Plus Models (Large Screens)

**Test Focus**:
- [ ] Content scales appropriately
- [ ] Not too much empty space
- [ ] Readable text (not too stretched)
- [ ] Landscape mode (if supported)

**Test Cases**:
```
1. Check booking cell height is comfortable
2. Verify guest list spacing
3. Test room search results layout
4. Check settings page doesn't look empty
```

---

## 📱 iPad Testing

### Important: iPad-Specific Updates Needed

The current app is optimized for iPhone. For proper iPad support, consider:

#### 1. Update Supported Orientations

**Current**:
- Portrait only (iPhone-style)

**iPad Should Support**:
- Portrait
- Landscape
- Split View
- Slide Over

#### 2. Layout Improvements for iPad

Let me create an iPad-optimized layout helper:

<function_calls>
<invoke name="str_replace_based_edit_tool">
<parameter name="command">create