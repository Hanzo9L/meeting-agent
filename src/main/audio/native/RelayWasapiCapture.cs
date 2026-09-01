using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

internal static class RelayWasapiCapture
{
    const int EDataFlowRender = 0;
    const int DeviceStateActive = 0x00000001;
    const int RoleConsole = 0;
    const int RoleCommunications = 2;
    const int ClsCtxAll = 23;
    const int StgmRead = 0;
    const int AudClntShareModeShared = 0;
    const int AudClntStreamflagsLoopback = 0x00020000;
    const int AudClntBufferflagsSilent = 0x2;
    const uint WaveFormatIeeeFloat = 3;
    const uint WaveFormatExtensible = 0xFFFE;
    const int VtLpWstr = 31;
    const int TargetRate = 16000;
    const int SyntheticSilenceFrameMs = 20;
    const int SyntheticSilenceMaxMs = 2500;
    const int DeviceInvalidated = unchecked((int)0x88890004);

    static readonly Guid IID_IAudioClient = new Guid("1CB9AD4C-DBFA-4c32-B178-C2F568A703B2");
    static readonly Guid IID_IAudioCaptureClient = new Guid("C8ADBD64-E71E-48a0-A4DE-185C395CD317");
    static readonly Guid IID_IAudioSessionManager2 = new Guid("77AA99A0-1BD6-484F-8BC7-2C654C9A9B6F");
    static readonly Guid IID_IAudioSessionControl2 = new Guid("bfb7ff88-7239-4fc9-8fa2-07c950be9c6d");
    static readonly Guid IID_IAudioMeterInformation = new Guid("C02216F6-8C67-4B5B-9D00-D008E73E0064");
    static readonly Guid KSDATAFORMAT_SUBTYPE_IEEE_FLOAT = new Guid("00000003-0000-0010-8000-00aa00389b71");
    static readonly Guid KSDATAFORMAT_SUBTYPE_PCM = new Guid("00000001-0000-0010-8000-00aa00389b71");
    static readonly PROPERTYKEY PKEY_Device_FriendlyName = new PROPERTYKEY
    {
        fmtid = new Guid("a45c254e-df1c-4efd-8020-67d146a850e0"),
        pid = 14
    };

    static int Main(string[] args)
    {
        try
        {
            var exclude = new List<int>();
            string mode = null;
            string captureId = null;
            for (int i = 0; i < args.Length; i++)
            {
                if (args[i] == "--enumerate") mode = "enumerate";
                else if (args[i] == "--capture" && i + 1 < args.Length)
                {
                    mode = "capture";
                    captureId = args[++i];
                }
                else if (args[i] == "--exclude-pid" && i + 1 < args.Length)
                {
                    int pid;
                    if (int.TryParse(args[++i], out pid)) exclude.Add(pid);
                }
            }
            if (mode == "enumerate")
            {
                Enumerate(exclude);
                return 0;
            }
            if (mode == "capture" && !string.IsNullOrEmpty(captureId))
            {
                Capture(captureId);
                return 0;
            }
            Console.Error.WriteLine("{\"event\":\"error\",\"message\":\"usage: --enumerate | --capture <endpointId>\"}");
            return 2;
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine("{\"event\":\"error\",\"message\":\"" + JsonEscape(ex.ToString()) + "\"}");
            return 1;
        }
    }

    static void Enumerate(List<int> excludePids)
    {
        var enumerator = (IMMDeviceEnumerator)new MMDeviceEnumeratorComObject();
        string defaultId = SafeDeviceId(enumerator, RoleConsole);
        string commsId = SafeDeviceId(enumerator, RoleCommunications);
        IMMDeviceCollection collection;
        Marshal.ThrowExceptionForHR(
            enumerator.EnumAudioEndpoints(EDataFlowRender, DeviceStateActive, out collection)
        );
        uint count;
        Marshal.ThrowExceptionForHR(collection.GetCount(out count));
        var sb = new StringBuilder();
        sb.Append("{\"defaultId\":");
        sb.Append(ToJson(defaultId));
        sb.Append(",\"communicationsDefaultId\":");
        sb.Append(ToJson(commsId));
        sb.Append(",\"endpoints\":[");
        bool first = true;
        for (uint i = 0; i < count; i++)
        {
            IMMDevice device;
            Marshal.ThrowExceptionForHR(collection.Item(i, out device));
            string id;
            Marshal.ThrowExceptionForHR(device.GetId(out id));
            string name = id;
            try
            {
                string friendly = ReadFriendlyName(device);
                if (!string.IsNullOrEmpty(friendly)) name = friendly;
            }
            catch
            {
            }
            if (!first) sb.Append(",");
            first = false;
            sb.Append("{\"id\":");
            sb.Append(ToJson(id));
            sb.Append(",\"name\":");
            sb.Append(ToJson(name));
            sb.Append(",\"isDefault\":");
            sb.Append(id == defaultId ? "true" : "false");
            sb.Append(",\"isCommunicationsDefault\":");
            sb.Append(id == commsId ? "true" : "false");
            sb.Append(",\"sessions\":[");
            WriteSessions(sb, device, excludePids);
            sb.Append("]}");
            try { Marshal.ReleaseComObject(device); } catch { }
        }
        sb.Append("]}");
        Console.OutputEncoding = Encoding.UTF8;
        Console.Write(sb.ToString());
        Marshal.ReleaseComObject(collection);
        Marshal.ReleaseComObject(enumerator);
    }

    static string SafeDeviceId(IMMDeviceEnumerator enumerator, int role)
    {
        try
        {
            IMMDevice device;
            int hr = enumerator.GetDefaultAudioEndpoint(EDataFlowRender, role, out device);
            if (hr != 0 || device == null) return null;
            string id;
            Marshal.ThrowExceptionForHR(device.GetId(out id));
            Marshal.ReleaseComObject(device);
            return id;
        }
        catch
        {
            return null;
        }
    }

    static void WriteSessions(StringBuilder sb, IMMDevice device, List<int> excludePids)
    {
        object managerObj;
        Guid sessionManagerIid = IID_IAudioSessionManager2;
        int hr = device.Activate(ref sessionManagerIid, ClsCtxAll, IntPtr.Zero, out managerObj);
        if (hr != 0 || managerObj == null) return;
        var manager = (IAudioSessionManager2)managerObj;
        IAudioSessionEnumerator sessions;
        hr = manager.GetSessionEnumerator(out sessions);
        if (hr != 0 || sessions == null)
        {
            Marshal.ReleaseComObject(manager);
            return;
        }
        int count;
        Marshal.ThrowExceptionForHR(sessions.GetCount(out count));
        bool first = true;
        for (int i = 0; i < count; i++)
        {
            IAudioSessionControl control;
            if (sessions.GetSession(i, out control) != 0 || control == null) continue;
            try
            {
                IAudioSessionControl2 control2 = QuerySessionControl2(control);
                if (control2 == null) continue;
                uint pid = 0;
                control2.GetProcessId(out pid);
                if (excludePids.Contains((int)pid)) continue;
                int state = 0;
                control.GetState(out state);
                string display = "";
                control.GetDisplayName(out display);
                float peak = 0f;
                IAudioMeterInformation meter = QueryMeter(control);
                if (meter != null) meter.GetPeakValue(out peak);
                string processName = "";
                if (pid > 0)
                {
                    try
                    {
                        processName = Process.GetProcessById((int)pid).ProcessName;
                    }
                    catch
                    {
                        processName = "";
                    }
                }
                if (!first) sb.Append(",");
                first = false;
                sb.Append("{\"processId\":");
                sb.Append(pid);
                sb.Append(",\"processName\":");
                sb.Append(ToJson(processName));
                sb.Append(",\"displayName\":");
                sb.Append(ToJson(display ?? ""));
                sb.Append(",\"state\":");
                sb.Append(ToJson(state == 1 ? "active" : state == 2 ? "expired" : "inactive"));
                sb.Append(",\"peak\":");
                sb.Append(peak.ToString(System.Globalization.CultureInfo.InvariantCulture));
                sb.Append("}");
            }
            finally
            {
                Marshal.ReleaseComObject(control);
            }
        }
        Marshal.ReleaseComObject(sessions);
        Marshal.ReleaseComObject(manager);
    }

    static string ReadFriendlyName(IMMDevice device)
    {
        IPropertyStore store = null;
        try
        {
            int hr = device.OpenPropertyStore(StgmRead, out store);
            if (hr != 0 || store == null) return null;
            PROPVARIANT value = new PROPVARIANT();
            PROPERTYKEY key = PKEY_Device_FriendlyName;
            hr = store.GetValue(ref key, out value);
            if (hr != 0) return null;
            try
            {
                if (value.vt == VtLpWstr && value.pointerValue != IntPtr.Zero)
                {
                    return Marshal.PtrToStringUni(value.pointerValue);
                }
            }
            finally
            {
                PropVariantClear(ref value);
            }
        }
        catch
        {
            return null;
        }
        finally
        {
            if (store != null)
            {
                try { Marshal.ReleaseComObject(store); } catch { }
            }
        }
        return null;
    }

    static void Capture(string endpointId)
    {
        var enumerator = (IMMDeviceEnumerator)new MMDeviceEnumeratorComObject();
        IMMDevice device;
        Marshal.ThrowExceptionForHR(enumerator.GetDevice(endpointId, out device));
        object clientObj;
        Guid audioClientIid = IID_IAudioClient;
        Marshal.ThrowExceptionForHR(
            device.Activate(ref audioClientIid, ClsCtxAll, IntPtr.Zero, out clientObj)
        );
        var client = (IAudioClient)clientObj;
        IntPtr mixFormatPtr;
        Marshal.ThrowExceptionForHR(client.GetMixFormat(out mixFormatPtr));
        var format = (WAVEFORMATEX)Marshal.PtrToStructure(mixFormatPtr, typeof(WAVEFORMATEX));
        bool ieeeFloat = format.wFormatTag == WaveFormatIeeeFloat;
        int channels = format.nChannels;
        int bits = format.wBitsPerSample;
        int rate = (int)format.nSamplesPerSec;
        if (format.wFormatTag == WaveFormatExtensible)
        {
            var ext = (WAVEFORMATEXTENSIBLE)Marshal.PtrToStructure(mixFormatPtr, typeof(WAVEFORMATEXTENSIBLE));
            ieeeFloat = ext.SubFormat == KSDATAFORMAT_SUBTYPE_IEEE_FLOAT;
            if (ext.SubFormat == KSDATAFORMAT_SUBTYPE_PCM) ieeeFloat = false;
            channels = ext.Format.nChannels;
            bits = ext.Format.wBitsPerSample;
            rate = (int)ext.Format.nSamplesPerSec;
        }
        int hr = client.Initialize(
            AudClntShareModeShared,
            AudClntStreamflagsLoopback,
            10000000,
            0,
            mixFormatPtr,
            IntPtr.Zero
        );
        Marshal.ThrowExceptionForHR(hr);
        object captureObj;
        Guid captureIid = IID_IAudioCaptureClient;
        Marshal.ThrowExceptionForHR(client.GetService(ref captureIid, out captureObj));
        var capture = (IAudioCaptureClient)captureObj;
        Marshal.ThrowExceptionForHR(client.Start());
        Console.Error.WriteLine("{\"event\":\"started\",\"endpointId\":\"" + JsonEscape(endpointId) + "\"}");
        var stdout = Console.OpenStandardOutput();
        double resampleCursor = 0;
        double ratio = (double)rate / TargetRate;
        float[] leftover = new float[0];
        bool hasSeenAudibleAudio = false;
        var noPacketClock = new Stopwatch();
        long nextSyntheticSilenceAtMs = SyntheticSilenceFrameMs;
        byte[] syntheticSilenceFrame =
            new byte[TargetRate * SyntheticSilenceFrameMs / 1000 * 2];
        try
        {
            while (true)
            {
                uint packet = 0;
                hr = capture.GetNextPacketSize(out packet);
                if (hr == DeviceInvalidated)
                {
                    Console.Error.WriteLine("{\"event\":\"gone\"}");
                    return;
                }
                Marshal.ThrowExceptionForHR(hr);
                if (packet == 0)
                {
                    if (!noPacketClock.IsRunning)
                    {
                        noPacketClock.Restart();
                        nextSyntheticSilenceAtMs = SyntheticSilenceFrameMs;
                    }
                    long silentForMs = noPacketClock.ElapsedMilliseconds;
                    if (
                        hasSeenAudibleAudio &&
                        silentForMs >= nextSyntheticSilenceAtMs &&
                        nextSyntheticSilenceAtMs <= SyntheticSilenceMaxMs
                    )
                    {
                        stdout.Write(
                            syntheticSilenceFrame,
                            0,
                            syntheticSilenceFrame.Length
                        );
                        stdout.Flush();
                        // Schedule from wall clock instead of catching up in a
                        // burst if this process was briefly descheduled.
                        nextSyntheticSilenceAtMs =
                            silentForMs + SyntheticSilenceFrameMs;
                    }
                    Thread.Sleep(5);
                    continue;
                }
                noPacketClock.Reset();
                nextSyntheticSilenceAtMs = SyntheticSilenceFrameMs;
                IntPtr data;
                uint frames;
                int flags;
                ulong pos;
                ulong qpc;
                hr = capture.GetBuffer(out data, out frames, out flags, out pos, out qpc);
                if (hr == DeviceInvalidated)
                {
                    Console.Error.WriteLine("{\"event\":\"gone\"}");
                    return;
                }
                Marshal.ThrowExceptionForHR(hr);
                float[] mono;
                if ((flags & AudClntBufferflagsSilent) != 0 || data == IntPtr.Zero)
                {
                    mono = new float[frames];
                }
                else
                {
                    mono = ToMonoFloat(data, (int)frames, channels, bits, ieeeFloat);
                    if (!hasSeenAudibleAudio && ContainsAudibleSignal(mono))
                    {
                        hasSeenAudibleAudio = true;
                    }
                }
                capture.ReleaseBuffer(frames);
                var pcm = Downsample(leftover, mono, ratio, ref resampleCursor, out leftover);
                if (pcm.Length > 0)
                {
                    stdout.Write(pcm, 0, pcm.Length);
                    stdout.Flush();
                }
            }
        }
        finally
        {
            try { client.Stop(); } catch { }
            Marshal.FreeCoTaskMem(mixFormatPtr);
            Marshal.ReleaseComObject(capture);
            Marshal.ReleaseComObject(client);
            Marshal.ReleaseComObject(device);
            Marshal.ReleaseComObject(enumerator);
        }
    }

    static bool ContainsAudibleSignal(float[] samples)
    {
        for (int i = 0; i < samples.Length; i++)
        {
            if (Math.Abs(samples[i]) >= 0.0001f) return true;
        }
        return false;
    }

    static float[] ToMonoFloat(IntPtr data, int frames, int channels, int bits, bool ieeeFloat)
    {
        var mono = new float[frames];
        int ch = Math.Max(1, channels);
        if (ieeeFloat && bits == 32)
        {
            int count = frames * ch;
            float[] interleaved = new float[count];
            Marshal.Copy(data, interleaved, 0, count);
            for (int f = 0; f < frames; f++)
            {
                float sum = 0;
                for (int c = 0; c < ch; c++) sum += interleaved[f * ch + c];
                mono[f] = sum / ch;
            }
            return mono;
        }
        if (!ieeeFloat && bits == 16)
        {
            int count = frames * ch;
            short[] interleaved = new short[count];
            Marshal.Copy(data, interleaved, 0, count);
            for (int f = 0; f < frames; f++)
            {
                float sum = 0;
                for (int c = 0; c < ch; c++) sum += interleaved[f * ch + c] / 32768f;
                mono[f] = sum / ch;
            }
            return mono;
        }
        if (!ieeeFloat && bits == 32)
        {
            int count = frames * ch;
            int[] interleaved = new int[count];
            Marshal.Copy(data, interleaved, 0, count);
            for (int f = 0; f < frames; f++)
            {
                float sum = 0;
                for (int c = 0; c < ch; c++) sum += interleaved[f * ch + c] / 2147483648f;
                mono[f] = sum / ch;
            }
            return mono;
        }
        return mono;
    }

    static byte[] Downsample(
        float[] leftover,
        float[] incoming,
        double ratio,
        ref double cursor,
        out float[] nextLeftover
    )
    {
        int total = leftover.Length + incoming.Length;
        var combined = new float[total];
        Buffer.BlockCopy(leftover, 0, combined, 0, leftover.Length * 4);
        Buffer.BlockCopy(incoming, 0, combined, leftover.Length * 4, incoming.Length * 4);
        var pcm = new List<byte>((int)(total / ratio) * 2 + 4);
        while (cursor + ratio <= total)
        {
            int start = (int)cursor;
            int end = Math.Min(total, (int)Math.Floor(cursor + ratio));
            if (end <= start) end = Math.Min(total, start + 1);
            float sum = 0;
            int count = 0;
            for (int i = start; i < end; i++)
            {
                sum += combined[i];
                count++;
            }
            float sample = count > 0 ? sum / count : 0f;
            if (sample > 1f) sample = 1f;
            if (sample < -1f) sample = -1f;
            short pcm16 = sample < 0 ? (short)(sample * 32768f) : (short)(sample * 32767f);
            pcm.Add((byte)(pcm16 & 0xFF));
            pcm.Add((byte)((pcm16 >> 8) & 0xFF));
            cursor += ratio;
        }
        int consumed = (int)cursor;
        if (consumed > total) consumed = total;
        int remain = total - consumed;
        nextLeftover = new float[remain];
        if (remain > 0) Array.Copy(combined, consumed, nextLeftover, 0, remain);
        cursor -= consumed;
        return pcm.ToArray();
    }

    static IAudioSessionControl2 QuerySessionControl2(IAudioSessionControl control)
    {
        try
        {
            return (IAudioSessionControl2)control;
        }
        catch
        {
            return null;
        }
    }

    static IAudioMeterInformation QueryMeter(IAudioSessionControl control)
    {
        try
        {
            return (IAudioMeterInformation)control;
        }
        catch
        {
            return null;
        }
    }

    static string ToJson(string value)
    {
        if (value == null) return "null";
        return "\"" + JsonEscape(value) + "\"";
    }

    static string JsonEscape(string value)
    {
        if (string.IsNullOrEmpty(value)) return "";
        return value
            .Replace("\\", "\\\\")
            .Replace("\"", "\\\"")
            .Replace("\r", "\\r")
            .Replace("\n", "\\n")
            .Replace("\t", "\\t");
    }

    [DllImport("ole32.dll")]
    internal static extern int PropVariantClear(ref PROPVARIANT pvar);
}

[ComImport]
[Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]
class MMDeviceEnumeratorComObject
{
}

[ComImport]
[Guid("A95664D2-9614-4F35-A746-DE8DB63617E6")]
[InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDeviceEnumerator
{
    [PreserveSig]
    int EnumAudioEndpoints(int dataFlow, int dwStateMask, [MarshalAs(UnmanagedType.Interface)] out IMMDeviceCollection devices);
    [PreserveSig]
    int GetDefaultAudioEndpoint(int dataFlow, int role, [MarshalAs(UnmanagedType.Interface)] out IMMDevice endpoint);
    [PreserveSig]
    int GetDevice([MarshalAs(UnmanagedType.LPWStr)] string pwstrId, [MarshalAs(UnmanagedType.Interface)] out IMMDevice device);
    [PreserveSig]
    int RegisterEndpointNotificationCallback(IntPtr client);
    [PreserveSig]
    int UnregisterEndpointNotificationCallback(IntPtr client);
}

[ComImport]
[Guid("0BD7A1BE-7A1A-44DB-8397-CC5392387B5E")]
[InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDeviceCollection
{
    [PreserveSig]
    int GetCount(out uint count);
    [PreserveSig]
    int Item(uint index, [MarshalAs(UnmanagedType.Interface)] out IMMDevice device);
}

[ComImport]
[Guid("D666063F-1587-4E43-81F1-B948E807363F")]
[InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDevice
{
    [PreserveSig]
    int Activate(ref Guid iid, int dwClsCtx, IntPtr activationParams, [MarshalAs(UnmanagedType.IUnknown)] out object interfacePointer);
    [PreserveSig]
    int OpenPropertyStore(int stgmAccess, [MarshalAs(UnmanagedType.Interface)] out IPropertyStore properties);
    [PreserveSig]
    int GetId([MarshalAs(UnmanagedType.LPWStr)] out string id);
    [PreserveSig]
    int GetState(out int state);
}

[ComImport]
[Guid("886d8eeb-8cf2-4446-8d02-cdba1dbdcf99")]
[InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IPropertyStore
{
    [PreserveSig]
    int GetCount(out uint count);
    [PreserveSig]
    int GetAt(uint iProp, out PROPERTYKEY pkey);
    [PreserveSig]
    int GetValue(ref PROPERTYKEY key, out PROPVARIANT pv);
    [PreserveSig]
    int SetValue(ref PROPERTYKEY key, ref PROPVARIANT pv);
    [PreserveSig]
    int Commit();
}

[ComImport]
[Guid("1CB9AD4C-DBFA-4c32-B178-C2F568A703B2")]
[InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IAudioClient
{
    [PreserveSig]
    int Initialize(int shareMode, int streamFlags, long hnsBufferDuration, long hnsPeriodicity, IntPtr format, IntPtr sessionGuid);
    [PreserveSig]
    int GetBufferSize(out uint bufferSize);
    [PreserveSig]
    int GetStreamLatency(out long latency);
    [PreserveSig]
    int GetCurrentPadding(out uint padding);
    [PreserveSig]
    int IsFormatSupported(int shareMode, IntPtr format, out IntPtr closestMatch);
    [PreserveSig]
    int GetMixFormat(out IntPtr deviceFormat);
    [PreserveSig]
    int GetDevicePeriod(out long defaultPeriod, out long minimumPeriod);
    [PreserveSig]
    int Start();
    [PreserveSig]
    int Stop();
    [PreserveSig]
    int Reset();
    [PreserveSig]
    int SetEventHandle(IntPtr eventHandle);
    [PreserveSig]
    int GetService(ref Guid iid, [MarshalAs(UnmanagedType.IUnknown)] out object service);
}

[ComImport]
[Guid("C8ADBD64-E71E-48a0-A4DE-185C395CD317")]
[InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IAudioCaptureClient
{
    [PreserveSig]
    int GetBuffer(out IntPtr data, out uint numFramesToRead, out int flags, out ulong devicePosition, out ulong qpcPosition);
    [PreserveSig]
    int ReleaseBuffer(uint numFramesRead);
    [PreserveSig]
    int GetNextPacketSize(out uint numFramesInNextPacket);
}

[ComImport]
[Guid("77AA99A0-1BD6-484F-8BC7-2C654C9A9B6F")]
[InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IAudioSessionManager2
{
    [PreserveSig]
    int GetAudioSessionControl(IntPtr audioSessionGuid, int streamFlags, out IntPtr sessionControl);
    [PreserveSig]
    int GetSimpleAudioVolume(IntPtr audioSessionGuid, int streamFlags, out IntPtr audioVolume);
    [PreserveSig]
    int GetSessionEnumerator([MarshalAs(UnmanagedType.Interface)] out IAudioSessionEnumerator sessionEnum);
    [PreserveSig]
    int RegisterSessionNotification(IntPtr newNotifications);
    [PreserveSig]
    int UnregisterSessionNotification(IntPtr newNotifications);
    [PreserveSig]
    int RegisterDuckNotification(string sessionID, IntPtr duckNotification);
    [PreserveSig]
    int UnregisterDuckNotification(IntPtr duckNotification);
}

[ComImport]
[Guid("E2F5BB11-0570-40CA-ACDD-3AA01277DEE8")]
[InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IAudioSessionEnumerator
{
    [PreserveSig]
    int GetCount(out int sessionCount);
    [PreserveSig]
    int GetSession(int sessionCount, [MarshalAs(UnmanagedType.Interface)] out IAudioSessionControl session);
}

[ComImport]
[Guid("F4B1A599-7266-4319-A8CA-E70ACB11E8CD")]
[InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IAudioSessionControl
{
    [PreserveSig]
    int GetState(out int state);
    [PreserveSig]
    int GetDisplayName([MarshalAs(UnmanagedType.LPWStr)] out string displayName);
    [PreserveSig]
    int SetDisplayName([MarshalAs(UnmanagedType.LPWStr)] string value, IntPtr eventContext);
    [PreserveSig]
    int GetIconPath([MarshalAs(UnmanagedType.LPWStr)] out string iconPath);
    [PreserveSig]
    int SetIconPath([MarshalAs(UnmanagedType.LPWStr)] string value, IntPtr eventContext);
    [PreserveSig]
    int GetGroupingParam(out Guid groupingParam);
    [PreserveSig]
    int SetGroupingParam(ref Guid groupingParam, IntPtr eventContext);
    [PreserveSig]
    int RegisterAudioSessionNotification(IntPtr newNotifications);
    [PreserveSig]
    int UnregisterAudioSessionNotification(IntPtr newNotifications);
}

[ComImport]
[Guid("bfb7ff88-7239-4fc9-8fa2-07c950be9c6d")]
[InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IAudioSessionControl2
{
    [PreserveSig]
    int GetState(out int state);
    [PreserveSig]
    int GetDisplayName([MarshalAs(UnmanagedType.LPWStr)] out string displayName);
    [PreserveSig]
    int SetDisplayName([MarshalAs(UnmanagedType.LPWStr)] string value, IntPtr eventContext);
    [PreserveSig]
    int GetIconPath([MarshalAs(UnmanagedType.LPWStr)] out string iconPath);
    [PreserveSig]
    int SetIconPath([MarshalAs(UnmanagedType.LPWStr)] string value, IntPtr eventContext);
    [PreserveSig]
    int GetGroupingParam(out Guid groupingParam);
    [PreserveSig]
    int SetGroupingParam(ref Guid groupingParam, IntPtr eventContext);
    [PreserveSig]
    int RegisterAudioSessionNotification(IntPtr newNotifications);
    [PreserveSig]
    int UnregisterAudioSessionNotification(IntPtr newNotifications);
    [PreserveSig]
    int GetSessionIdentifier([MarshalAs(UnmanagedType.LPWStr)] out string sessionId);
    [PreserveSig]
    int GetSessionInstanceIdentifier([MarshalAs(UnmanagedType.LPWStr)] out string instanceId);
    [PreserveSig]
    int GetProcessId(out uint pid);
    [PreserveSig]
    int IsSystemSoundsSession();
    [PreserveSig]
    int SetDuckingPreference(int optOut);
}

[ComImport]
[Guid("C02216F6-8C67-4B5B-9D00-D008E73E0064")]
[InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IAudioMeterInformation
{
    [PreserveSig]
    int GetPeakValue(out float peak);
    [PreserveSig]
    int GetMeteringChannelCount(out uint channelCount);
    [PreserveSig]
    int GetChannelsPeakValues(uint channelCount, [Out] float[] peakValues);
    [PreserveSig]
    int QueryHardwareSupport(out int hardwareSupportMask);
}

[StructLayout(LayoutKind.Sequential)]
struct PROPERTYKEY
{
    public Guid fmtid;
    public uint pid;
}

[StructLayout(LayoutKind.Explicit)]
struct PROPVARIANT
{
    [FieldOffset(0)] public ushort vt;
    [FieldOffset(8)] public IntPtr pointerValue;
}

[StructLayout(LayoutKind.Sequential, Pack = 2)]
struct WAVEFORMATEX
{
    public ushort wFormatTag;
    public ushort nChannels;
    public uint nSamplesPerSec;
    public uint nAvgBytesPerSec;
    public ushort nBlockAlign;
    public ushort wBitsPerSample;
    public ushort cbSize;
}

[StructLayout(LayoutKind.Sequential, Pack = 2)]
struct WAVEFORMATEXTENSIBLE
{
    public WAVEFORMATEX Format;
    public ushort wValidBitsPerSample;
    public uint dwChannelMask;
    public Guid SubFormat;
}

