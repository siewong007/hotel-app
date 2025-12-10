//
//  StatisticsView.swift
//  PasskeyApp
//
//  Created on December 7, 2025.
//

import SwiftUI
import Charts

// MARK: - Statistics Models

struct ActivityStatistic: Identifiable {
    let id = UUID()
    let date: Date
    let count: Int
    let category: String
}

struct UsageData: Identifiable {
    let id = UUID()
    let hour: Int
    let sessions: Int
}

struct AuthenticationStats {
    var totalSignIns: Int
    var successfulSignIns: Int
    var failedSignIns: Int
    var averageSignInTime: TimeInterval
    var lastSignIn: Date
    
    var successRate: Double {
        guard totalSignIns > 0 else { return 0 }
        return Double(successfulSignIns) / Double(totalSignIns) * 100
    }
}

// MARK: - Statistics View

struct StatisticsView: View {
    @EnvironmentObject var authManager: AuthenticationManager
    @State private var selectedTimeRange: TimeRange = .week
    @State private var authStats = AuthenticationStats(
        totalSignIns: 47,
        successfulSignIns: 45,
        failedSignIns: 2,
        averageSignInTime: 1.2,
        lastSignIn: Date()
    )
    
    enum TimeRange: String, CaseIterable {
        case day = "Day"
        case week = "Week"
        case month = "Month"
        case year = "Year"
    }
    
    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 24) {
                    // Time Range Picker
                    timeRangePicker
                    
                    // Overview Cards
                    overviewCards
                    
                    // Authentication Success Rate Chart
                    authenticationSuccessChart
                    
                    // Daily Activity Chart
                    dailyActivityChart
                    
                    // Usage by Time of Day Chart
                    usageByTimeChart
                    
                    // Security Insights
                    securityInsights
                }
                .padding()
            }
            .navigationTitle("Statistics")
            .background(Color(.systemGroupedBackground))
        }
    }
    
    // MARK: - Time Range Picker
    
    private var timeRangePicker: some View {
        Picker("Time Range", selection: $selectedTimeRange) {
            ForEach(TimeRange.allCases, id: \.self) { range in
                Text(range.rawValue).tag(range)
            }
        }
        .pickerStyle(.segmented)
        .padding(.horizontal)
    }
    
    // MARK: - Overview Cards
    
    private var overviewCards: some View {
        LazyVGrid(columns: [
            GridItem(.flexible()),
            GridItem(.flexible())
        ], spacing: 16) {
            StatCard(
                title: "Total Sign-ins",
                value: "\(authStats.totalSignIns)",
                icon: "arrow.right.circle.fill",
                color: .blue
            )
            
            StatCard(
                title: "Success Rate",
                value: String(format: "%.1f%%", authStats.successRate),
                icon: "checkmark.circle.fill",
                color: .green
            )
            
            StatCard(
                title: "Avg. Time",
                value: String(format: "%.1fs", authStats.averageSignInTime),
                icon: "clock.fill",
                color: .orange
            )
            
            StatCard(
                title: "Failed",
                value: "\(authStats.failedSignIns)",
                icon: "xmark.circle.fill",
                color: .red
            )
        }
        .padding(.horizontal)
    }
    
    // MARK: - Authentication Success Chart
    
    private var authenticationSuccessChart: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Authentication Performance")
                .font(.headline)
                .padding(.horizontal)
            
            Chart {
                SectorMark(
                    angle: .value("Count", authStats.successfulSignIns),
                    innerRadius: .ratio(0.65),
                    angularInset: 1.5
                )
                .foregroundStyle(.green.gradient)
                .annotation(position: .overlay) {
                    VStack {
                        Text("\(Int(authStats.successRate))%")
                            .font(.system(size: 28, weight: .bold))
                        Text("Success")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }
                
                SectorMark(
                    angle: .value("Count", authStats.failedSignIns),
                    innerRadius: .ratio(0.65),
                    angularInset: 1.5
                )
                .foregroundStyle(.red.gradient)
            }
            .frame(height: 250)
            .chartLegend(position: .bottom, alignment: .center)
            .padding()
            .background(.ultraThinMaterial)
            .clipShape(RoundedRectangle(cornerRadius: 16))
            .padding(.horizontal)
        }
    }
    
    // MARK: - Daily Activity Chart
    
    private var dailyActivityChart: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Daily Activity")
                .font(.headline)
                .padding(.horizontal)
            
            Chart(generateDailyData()) { item in
                BarMark(
                    x: .value("Date", item.date, unit: .day),
                    y: .value("Sign-ins", item.count)
                )
                .foregroundStyle(.blue.gradient)
                .cornerRadius(6)
            }
            .frame(height: 200)
            .chartXAxis {
                AxisMarks(values: .stride(by: .day)) { value in
                    AxisGridLine()
                    AxisTick()
                    AxisValueLabel(format: .dateTime.weekday(.narrow))
                }
            }
            .chartYAxis {
                AxisMarks(position: .leading)
            }
            .padding()
            .background(.ultraThinMaterial)
            .clipShape(RoundedRectangle(cornerRadius: 16))
            .padding(.horizontal)
        }
    }
    
    // MARK: - Usage by Time Chart
    
    private var usageByTimeChart: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Usage by Time of Day")
                .font(.headline)
                .padding(.horizontal)
            
            Chart(generateUsageData()) { item in
                LineMark(
                    x: .value("Hour", item.hour),
                    y: .value("Sessions", item.sessions)
                )
                .foregroundStyle(.purple.gradient)
                .lineStyle(StrokeStyle(lineWidth: 3))
                .interpolationMethod(.catmullRom)
                
                AreaMark(
                    x: .value("Hour", item.hour),
                    y: .value("Sessions", item.sessions)
                )
                .foregroundStyle(.purple.gradient.opacity(0.2))
                .interpolationMethod(.catmullRom)
            }
            .frame(height: 200)
            .chartXAxis {
                AxisMarks(values: [0, 6, 12, 18, 24]) { value in
                    AxisGridLine()
                    AxisTick()
                    if let hour = value.as(Int.self) {
                        AxisValueLabel {
                            Text("\(hour):00")
                                .font(.caption)
                        }
                    }
                }
            }
            .chartYAxis {
                AxisMarks(position: .leading)
            }
            .padding()
            .background(.ultraThinMaterial)
            .clipShape(RoundedRectangle(cornerRadius: 16))
            .padding(.horizontal)
        }
    }
    
    // MARK: - Security Insights
    
    private var securityInsights: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Security Insights")
                .font(.headline)
                .padding(.horizontal)
            
            VStack(spacing: 12) {
                InsightRow(
                    icon: "checkmark.shield.fill",
                    title: "Passkey Active",
                    description: "Your account is secured with passkey authentication",
                    color: .green
                )
                
                InsightRow(
                    icon: "clock.fill",
                    title: "Last Sign-in",
                    description: authStats.lastSignIn.formatted(date: .abbreviated, time: .shortened),
                    color: .blue
                )
                
                InsightRow(
                    icon: "lock.icloud.fill",
                    title: "iCloud Keychain",
                    description: "Synced across all your devices",
                    color: .purple
                )
                
                InsightRow(
                    icon: "faceid",
                    title: "Biometric Auth",
                    description: "Face ID enabled for secure access",
                    color: .orange
                )
            }
            .padding()
            .background(.ultraThinMaterial)
            .clipShape(RoundedRectangle(cornerRadius: 16))
            .padding(.horizontal)
        }
    }
    
    // MARK: - Data Generation
    
    private func generateDailyData() -> [ActivityStatistic] {
        let calendar = Calendar.current
        let today = Date()
        
        return (0..<7).map { dayOffset in
            let date = calendar.date(byAdding: .day, value: -dayOffset, to: today)!
            return ActivityStatistic(
                date: date,
                count: Int.random(in: 3...12),
                category: "Sign-ins"
            )
        }.reversed()
    }
    
    private func generateUsageData() -> [UsageData] {
        return (0...24).map { hour in
            UsageData(
                hour: hour,
                sessions: generateSessionCount(for: hour)
            )
        }
    }
    
    private func generateSessionCount(for hour: Int) -> Int {
        // Simulate realistic usage patterns
        switch hour {
        case 0...6: return Int.random(in: 0...2)
        case 7...9: return Int.random(in: 3...8)
        case 10...12: return Int.random(in: 5...10)
        case 13...17: return Int.random(in: 6...12)
        case 18...21: return Int.random(in: 4...9)
        case 22...23: return Int.random(in: 1...4)
        default: return 0
        }
    }
}

// MARK: - Supporting Views

struct StatCard: View {
    let title: String
    let value: String
    let icon: String
    let color: Color
    
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Image(systemName: icon)
                    .font(.system(size: 20))
                    .foregroundStyle(color.gradient)
                Spacer()
            }
            
            Text(value)
                .font(.system(size: 28, weight: .bold))
            
            Text(title)
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding()
        .background(.ultraThinMaterial)
        .clipShape(RoundedRectangle(cornerRadius: 12))
    }
}

struct InsightRow: View {
    let icon: String
    let title: String
    let description: String
    let color: Color
    
    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: icon)
                .font(.system(size: 20))
                .foregroundStyle(color.gradient)
                .frame(width: 32)
            
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(.subheadline)
                    .fontWeight(.medium)
                
                Text(description)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            
            Spacer()
            
            Image(systemName: "checkmark.circle.fill")
                .foregroundStyle(.green)
        }
        .padding(.vertical, 4)
    }
}

// MARK: - Preview

#Preview {
    StatisticsView()
        .environmentObject(AuthenticationManager())
}
