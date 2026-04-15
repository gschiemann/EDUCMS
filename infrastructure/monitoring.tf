# monitoring.tf - Observability and Alerting Strategies

resource "aws_sns_topic" "p1_critical_alerts" {
  name = "edu-cms-p1-critical-${var.environment}"
}

resource "aws_sns_topic" "p2_high_alerts" {
  name = "edu-cms-p2-high-${var.environment}"
}

# P1 Alert: ALB Total Failure (API Complete Failure)
resource "aws_cloudwatch_metric_alarm" "alb_5xx_errors_p1" {
  alarm_name          = "edu-cms-alb-5xx-P1-${var.environment}"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  metric_name         = "HTTPCode_Target_5XX_Count"
  namespace           = "AWS/ApplicationELB"
  period              = 60 # 1 minute
  statistic           = "Sum"
  threshold           = 50 # Unacceptable failure rate
  alarm_description   = "P1: Total API failure detection > 50 5xx responses in 60s"
  alarm_actions       = [aws_sns_topic.p1_critical_alerts.arn]
  
  dimensions = {
    LoadBalancer = aws_lb.api_alb.arn_suffix
  }
}

# P2 Alert: High Latency Warning
resource "aws_cloudwatch_metric_alarm" "alb_high_latency_p2" {
  alarm_name          = "edu-cms-alb-latency-P2-${var.environment}"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  metric_name         = "TargetResponseTime"
  namespace           = "AWS/ApplicationELB"
  period              = 60
  statistic           = "p99"
  threshold           = 2.0 # > 2 seconds
  alarm_description   = "P2: Degraded Performance - Latency > 2s p99"
  alarm_actions       = [aws_sns_topic.p2_high_alerts.arn]

  dimensions = {
    LoadBalancer = aws_lb.api_alb.arn_suffix
  }
}
