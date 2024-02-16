package templates

import (
	"github.com/aws/aws-cdk-go/awscdk/v2"
	"github.com/aws/aws-cdk-go/awscdk/v2/awsautoscaling"
	"github.com/aws/aws-cdk-go/awscdk/v2/awsec2"
	"github.com/aws/aws-cdk-go/awscdk/v2/awselasticache"
	"github.com/aws/aws-cdk-go/awscdk/v2/awselasticloadbalancingv2"
	"github.com/aws/aws-cdk-go/awscdk/v2/awsiam"
	"github.com/aws/jsii-runtime-go"
)

func CreateElastiCache() {
	// Create the app properly
	app := awscdk.NewApp(nil)

	// pass it as parameter or use this function as main
	stack := awscdk.NewStack(app, jsii.String("StickySessionStack"), &awscdk.StackProps{
		Env: &awscdk.Environment{
			Account: jsii.String("YOUR_ACCOUNT_ID"),
			Region:  jsii.String("YOUR_REGION"),
		},
	})

	// Create a VPC
	vpc := awsec2.NewVpc(stack, jsii.String("MyVPC"), &awsec2.VpcProps{
		MaxAzs: jsii.Number(2),
		SubnetConfiguration: &[]*awsec2.SubnetConfiguration{
			{
				CidrMask:   jsii.Number(24),
				Name:       jsii.String("Public"),
				SubnetType: awsec2.SubnetType_PUBLIC,
			},
			{
				CidrMask:   jsii.Number(24),
				Name:       jsii.String("Private"),
				SubnetType: awsec2.SubnetType_PRIVATE_WITH_EGRESS,
			},
		},
	})

	// Create a security group for Elasticache
	cacheSecurityGroup := awsec2.NewSecurityGroup(stack, jsii.String("CacheSecurityGroup"), &awsec2.SecurityGroupProps{
		Vpc:         vpc,
		Description: jsii.String("Security group for Elasticache"),
	})
	cacheSecurityGroup.AddIngressRule(awsec2.Peer_Ipv4(vpc.VpcCidrBlock()), awsec2.Port_Tcp(jsii.Number(6379)), jsii.String("Allow inbound from VPC"), nil)

	// Create the Elasticache cluster
	cacheCluster := awselasticache.NewCfnCacheCluster(stack, jsii.String("MyCacheCluster"), &awselasticache.CfnCacheClusterProps{
		CacheNodeType:       jsii.String("cache.t2.micro"),
		Engine:              jsii.String("redis"),
		NumCacheNodes:       jsii.Number(1),
		VpcSecurityGroupIds: jsii.Strings(*cacheSecurityGroup.SecurityGroupId()),
		ClusterName:         jsii.String("my-cache-cluster"),
	})

	subnets := vpc.PrivateSubnets()
	var subnetIds []*string
	for _, v := range *subnets {
		subnetIds = append(subnetIds, v.SubnetId())
	}
	// Create a subnet group for the Elasticache cluster
	redisSubnetGroup := awselasticache.NewCfnSubnetGroup(stack, jsii.String("RedisSubnetGroup"), &awselasticache.CfnSubnetGroupProps{
		Description:          jsii.String("Subnet group for the Redis cluster"),
		SubnetIds:            &subnetIds,
		CacheSubnetGroupName: jsii.String("Redis-Subnet-Group"),
	})
	cacheCluster.AddDependsOn(redisSubnetGroup)

	// Create an ALB in a public subnet
	alb := awselasticloadbalancingv2.NewApplicationLoadBalancer(stack, jsii.String("MyALB"), &awselasticloadbalancingv2.ApplicationLoadBalancerProps{
		Vpc:            vpc,
		InternetFacing: jsii.Bool(true),
		VpcSubnets: &awsec2.SubnetSelection{
			SubnetType: awsec2.SubnetType_PUBLIC,
		},
	})

	// Create an IAM role for EC2 instances
	instanceRole := awsiam.NewRole(stack, jsii.String("InstanceRole"), &awsiam.RoleProps{
		AssumedBy: awsiam.NewServicePrincipal(jsii.String("ec2.amazonaws.com"), nil),
	})
	instanceRole.AddManagedPolicy(awsiam.ManagedPolicy_FromAwsManagedPolicyName(jsii.String("AmazonSSMManagedInstanceCore")))

	// Create an Auto Scaling Group
	asg := awsautoscaling.NewAutoScalingGroup(stack, jsii.String("MyAutoScalingGroup"), &awsautoscaling.AutoScalingGroupProps{
		Vpc:             vpc,
		InstanceType:    awsec2.InstanceType_Of(awsec2.InstanceClass_T2, awsec2.InstanceSize_MICRO),
		MachineImage:    awsec2.MachineImage_LatestAmazonLinux2(nil),
		MinCapacity:     jsii.Number(2),
		MaxCapacity:     jsii.Number(4),
		DesiredCapacity: jsii.Number(2),
		Role:            instanceRole,
		VpcSubnets: &awsec2.SubnetSelection{
			SubnetType: awsec2.SubnetType_PRIVATE_WITH_EGRESS,
		},
	})

	targets := []awselasticloadbalancingv2.IApplicationLoadBalancerTarget{}
	targets = append(targets, asg)
	// Create a target group for the ALB
	awselasticloadbalancingv2.NewApplicationTargetGroup(stack, jsii.String("MyTargetGroup"), &awselasticloadbalancingv2.ApplicationTargetGroupProps{
		Port:       jsii.Number(80),
		Targets:    &targets,
		Vpc:        vpc,
		TargetType: awselasticloadbalancingv2.TargetType_INSTANCE,
	})

	// Attach the target group to the ALB listener
	listener := alb.AddListener(jsii.String("Listener"), &awselasticloadbalancingv2.BaseApplicationListenerProps{Port: jsii.Number(80)})
	httpslistener := alb.AddListener(jsii.String("HTTPSListener"), &awselasticloadbalancingv2.BaseApplicationListenerProps{Port: jsii.Number(443)})
	listener.AddTargets(jsii.String("TargetGroup"), &awselasticloadbalancingv2.AddApplicationTargetsProps{Targets: &targets, LoadBalancingAlgorithmType: awselasticloadbalancingv2.TargetGroupLoadBalancingAlgorithmType_LEAST_OUTSTANDING_REQUESTS})
	httpslistener.AddTargets(jsii.String("HTTPSTargetGroup"), &awselasticloadbalancingv2.AddApplicationTargetsProps{Targets: &targets})

	// Synth with options if necessary
	app.Synth(nil)
}
